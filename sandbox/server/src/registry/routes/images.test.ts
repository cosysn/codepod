/**
 * Unit tests for Images API routes
 */

import express from 'express';
import request from 'supertest';
import { imagesRouter } from './images';
import { RegistryService } from '../services/registry';
import * as fs from 'fs';
import * as path from 'path';

describe('Images API', () => {
  let app: express.Express;
  const testRoot = '/tmp/test-images-api-' + Date.now();

  beforeAll(async () => {
    // Set environment variable for registry storage
    process.env.CODEPOD_REGISTRY_STORAGE = testRoot;

    // Create registry with shared storage
    const registry = new RegistryService(testRoot);

    // Add test data
    const manifest = { schemaVersion: 2, layers: [] };
    await registry.pushManifest('python', '3.11', manifest as any);
    await registry.pushManifest('nodejs', '20', manifest as any);

    // Set up Express app
    app = express();
    app.use(express.json());
    app.use('/api/v1/registry/images', imagesRouter);
  });

  afterAll(() => {
    // Clean up environment variable
    delete process.env.CODEPOD_REGISTRY_STORAGE;
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  describe('GET /api/v1/registry/images', () => {
    test('should return list of images', async () => {
      const response = await request(app).get('/api/v1/registry/images');
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('images');
      expect(response.body.images).toContain('python');
      expect(response.body.images).toContain('nodejs');
    });
  });

  describe('GET /api/v1/registry/images/:name', () => {
    test('should return image details with tags', async () => {
      const response = await request(app).get('/api/v1/registry/images/python');
      expect(response.status).toBe(200);
      expect(response.body.name).toBe('python');
      expect(response.body.tags).toContain('3.11');
    });
  });

  describe('DELETE /api/v1/registry/images/:name', () => {
    test('should delete image and all its tags', async () => {
      // First add a test image to delete
      const registry = new RegistryService(testRoot);
      const manifest = { schemaVersion: 2, layers: [] };
      await registry.pushManifest('test-image', 'latest', manifest as any);

      const response = await request(app).delete('/api/v1/registry/images/test-image');
      expect(response.status).toBe(200);
      expect(response.body.message).toContain('deleted');
      expect(response.body.deletedTags).toBeGreaterThanOrEqual(1);

      // Verify deleted
      const getResponse = await request(app).get('/api/v1/registry/images/test-image');
      expect(getResponse.body.tags).toEqual([]);
    });
  });
});
