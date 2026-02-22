/**
 * Unit tests for Docker Registry V2 API routes
 */

import express from 'express';
import request from 'supertest';
import { v2Router } from './v2';
import { RegistryService } from '../services/registry';
import * as fs from 'fs';

describe('Docker Registry V2 API', () => {
  let app: express.Express;
  const testRoot = '/tmp/test-v2-api-' + Date.now();

  beforeAll(async () => {
    // Set environment variable for registry storage
    process.env.CODEPOD_REGISTRY_STORAGE = testRoot;

    // Create registry with test data
    const registry = new RegistryService(testRoot);

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

    await registry.pushManifest('test-image', 'latest', manifest);

    // Set up Express app
    app = express();
    app.use(express.raw({ type: '*/*', limit: '10gb' }));
    app.use(express.json());
    app.use('/registry/v2', v2Router);
  });

  afterAll(() => {
    delete process.env.CODEPOD_REGISTRY_STORAGE;
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  describe('GET /registry/v2/', () => {
    test('should return API version info', async () => {
      const response = await request(app).get('/registry/v2/');
      expect(response.status).toBe(200);
      expect(response.body.version).toBe('2.0');
      expect(response.body.name).toBe('codepod-registry');
    });
  });

  describe('GET /registry/v2/_catalog', () => {
    test('should return repositories', async () => {
      const response = await request(app).get('/registry/v2/_catalog');
      expect(response.status).toBe(200);
      expect(response.body.repositories).toContain('test-image');
    });
  });

  describe('GET /registry/v2/<name>/tags/list', () => {
    test('should return tags for image', async () => {
      const response = await request(app).get('/registry/v2/test-image/tags/list');
      expect(response.status).toBe(200);
      expect(response.body.name).toBe('test-image');
      expect(response.body.tags).toContain('latest');
    });

    test('should return 404 for non-existent image', async () => {
      const response = await request(app).get('/registry/v2/nonexistent/tags/list');
      expect(response.status).toBe(404);
    });
  });

  describe('GET /registry/v2/<name>/manifests/<ref>', () => {
    test('should return manifest', async () => {
      const response = await request(app).get('/registry/v2/test-image/manifests/latest');
      expect(response.status).toBe(200);
      expect(response.body.schemaVersion).toBe(2);
      expect(response.body.layers).toBeDefined();
    });
  });

  describe('HEAD /registry/v2/<name>/blobs/<digest>', () => {
    test('should return 200 for existing blob', async () => {
      // First push a blob
      const registry = new RegistryService(testRoot);
      const content = Buffer.from('blob content');
      const digest = await registry.storeBlob(content);

      const response = await request(app)
        .head(`/registry/v2/test-image/blobs/${digest}`)
        .set('Accept', 'application/json');

      expect(response.status).toBe(200);
    });

    test('should return 404 for non-existent blob', async () => {
      const response = await request(app)
        .head('/registry/v2/test-image/blobs/sha256:nonexistent12345678901234567890123456789012345678901234')
        .set('Accept', 'application/json');

      expect(response.status).toBe(404);
    });
  });

  describe('POST /registry/v2/<name>/blobs/uploads/', () => {
    test('should initiate blob upload', async () => {
      const response = await request(app)
        .post('/registry/v2/test-image/blobs/uploads/')
        .set('Content-Type', 'application/json')
        .send({});

      expect(response.status).toBe(202);
      expect(response.body.uploadUrl).toBeDefined();
    });
  });

  describe('PUT /registry/v2/<name>/blobs/uploads/<id>', () => {
    test('should upload blob', async () => {
      const content = Buffer.from('uploaded content');

      const response = await request(app)
        .put('/registry/v2/test-image/blobs/uploads/test-id')
        .set('Content-Type', 'application/octet-stream')
        .send(content);

      expect(response.status).toBe(201);
      expect(response.body.digest).toMatch(/^sha256:/);
    });
  });

  describe('DELETE /registry/v2/<name>/manifests/<ref>', () => {
    test('should delete manifest', async () => {
      // First add a test manifest
      const registry = new RegistryService(testRoot);
      const manifest = { schemaVersion: 2, layers: [] };
      await registry.pushManifest('test-image', 'to-delete', manifest as any);

      const response = await request(app).delete('/registry/v2/test-image/manifests/to-delete');
      expect(response.status).toBe(202);
    });
  });
});
