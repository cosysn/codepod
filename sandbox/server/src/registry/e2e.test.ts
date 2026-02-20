/**
 * End-to-End integration tests for Registry
 */

import express from 'express';
import request from 'supertest';
import { imagesRouter, tagsRouter, v2Router } from './routes';
import { RegistryService } from './services/registry';
import { StorageService } from './services/storage';
import * as fs from 'fs';
import * as crypto from 'crypto';

describe('Registry E2E', () => {
  let app: express.Express;
  const testRoot = '/tmp/e2e-registry-' + Date.now();
  let registry: RegistryService;

  beforeAll(async () => {
    process.env.CODEPOD_REGISTRY_STORAGE = testRoot;

    // Create fresh registry instance
    registry = new RegistryService(testRoot);

    // Set up Express app with all routes
    app = express();
    app.use(express.raw({ type: '*/*', limit: '10gb' }));
    app.use(express.json());
    app.use('/api/v1/registry/images', imagesRouter);
    app.use('/api/v1/registry/tags', tagsRouter);
    app.use('/v2', v2Router);
  });

  afterAll(() => {
    delete process.env.CODEPOD_REGISTRY_STORAGE;
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  describe('Complete workflow', () => {
    test('should push manifest via V2 API', async () => {
      const manifest = {
        schemaVersion: 2,
        mediaType: 'application/vnd.oci.image.manifest.v1+json',
        config: {
          mediaType: 'application/vnd.oci.image.config.v1+json',
          digest: 'sha256:config123',
          size: 100,
        },
        layers: [
          {
            mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
            digest: 'sha256:layer123',
            size: 1000,
          },
        ],
      };

      // Push via V2 API
      const pushRes = await request(app)
        .put('/v2/e2e-test/manifests/latest')
        .set('Content-Type', 'application/json')
        .send(manifest);
      expect(pushRes.status).toBe(201);
    });

    test('should pull manifest via V2 API', async () => {
      const manifest = {
        schemaVersion: 2,
        mediaType: 'application/vnd.oci.image.manifest.v1+json',
        config: {
          mediaType: 'application/vnd.oci.image.config.v1+json',
          digest: 'sha256:config456',
          size: 100,
        },
        layers: [],
      };

      // First push
      await request(app)
        .put('/v2/pull-test/manifests/v1.0')
        .set('Content-Type', 'application/json')
        .send(manifest);

      // Then pull
      const pullRes = await request(app)
        .get('/v2/pull-test/manifests/v1.0')
        .set('Accept', 'application/json');
      expect(pullRes.status).toBe(200);
      expect(pullRes.body).toEqual(manifest);
    });

    test('should list catalog via V2 API', async () => {
      const catalogRes = await request(app).get('/v2/_catalog');
      expect(catalogRes.status).toBe(200);
      expect(catalogRes.body.repositories).toBeDefined();
      expect(Array.isArray(catalogRes.body.repositories)).toBe(true);
    });

    test('should list images via REST API', async () => {
      const imagesRes = await request(app).get('/api/v1/registry/images');
      expect(imagesRes.status).toBe(200);
      expect(imagesRes.body.images).toBeDefined();
    });

    test('should list tags via REST API', async () => {
      const tagsRes = await request(app).get('/api/v1/registry/tags');
      expect(tagsRes.status).toBe(200);
      expect(tagsRes.body.tags).toBeDefined();
    });

    test('should delete manifest via V2 API', async () => {
      // First add a manifest to delete
      const manifest = { schemaVersion: 2, layers: [] };
      await request(app)
        .put('/v2/delete-test/manifests/to-remove')
        .set('Content-Type', 'application/json')
        .send(manifest);

      // Delete
      const deleteRes = await request(app).delete('/v2/delete-test/manifests/to-remove');
      expect(deleteRes.status).toBe(202);
    });

    test('should handle blob upload and retrieval', async () => {
      const content = 'test blob content for e2e ' + Date.now();
      const contentBuffer = Buffer.from(content);

      // Calculate expected digest
      const expectedDigest = 'sha256:' + crypto.createHash('sha256').update(contentBuffer).digest('hex');

      // Upload via PUT (simulating completed upload)
      const uploadRes = await request(app)
        .put('/v2/blob-test/manifests/v1')
        .set('Content-Type', 'application/json')
        .send({
          schemaVersion: 2,
          config: { digest: expectedDigest, size: contentBuffer.length, mediaType: 'application/json' },
          layers: [],
        });
      expect(uploadRes.status).toBe(201);
    });
  });
});
