/**
 * Unit tests for registry server
 */

import * as http from 'http';
import express from 'express';
import request from 'supertest';
import { imagesRouter, tagsRouter, v2Router } from './routes';

describe('Registry Server Integration', () => {
  let app: express.Express;
  const testRoot = '/tmp/test-registry-server-' + Date.now();

  beforeAll(async () => {
    process.env.CODEPOD_REGISTRY_STORAGE = testRoot;

    app = express();
    app.use(express.raw({ type: '*/*', limit: '10gb' }));
    app.use(express.json());
    app.use('/api/v1/registry/images', imagesRouter);
    app.use('/api/v1/registry/tags', tagsRouter);
    app.use('/v2', v2Router);
    app.get('/health', (req, res) => {
      res.json({ status: 'healthy', module: 'registry' });
    });
  });

  afterAll(() => {
    delete process.env.CODEPOD_REGISTRY_STORAGE;
  });

  describe('Health check', () => {
    test('should return healthy status', async () => {
      const response = await request(app).get('/health');
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('healthy');
    });
  });

  describe('Full workflow', () => {
    test('should push and pull manifest via V2 API', async () => {
      const manifest = {
        schemaVersion: 2,
        mediaType: 'application/vnd.oci.image.manifest.v1+json',
        config: {
          mediaType: 'application/vnd.oci.image.config.v1+json',
          digest: 'sha256:config123',
          size: 100,
        },
        layers: [],
      };

      // Push via V2 API
      const pushRes = await request(app)
        .put('/v2/test-image/manifests/latest')
        .set('Content-Type', 'application/json')
        .send(manifest);
      expect(pushRes.status).toBe(201);

      // Pull via V2 API
      const pullRes = await request(app)
        .get('/v2/test-image/manifests/latest')
        .set('Accept', 'application/json');
      expect(pullRes.status).toBe(200);
      expect(pullRes.body).toEqual(manifest);

      // List via catalog
      const catalogRes = await request(app).get('/v2/_catalog');
      expect(catalogRes.status).toBe(200);
      expect(catalogRes.body.repositories).toContain('test-image');

      // List via images API
      const imagesRes = await request(app).get('/api/v1/registry/images');
      expect(imagesRes.status).toBe(200);
      expect(imagesRes.body.images).toContain('test-image');
    });
  });
});
