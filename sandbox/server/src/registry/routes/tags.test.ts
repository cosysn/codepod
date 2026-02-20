/**
 * Unit tests for Tags API routes
 */

import express from 'express';
import request from 'supertest';
import { tagsRouter } from './tags';
import { RegistryService } from '../services/registry';
import * as fs from 'fs';

describe('Tags API', () => {
  let app: express.Express;
  const testRoot = '/tmp/test-tags-api-' + Date.now();

  beforeAll(async () => {
    // Set environment variable for registry storage
    process.env.CODEPOD_REGISTRY_STORAGE = testRoot;

    // Create registry with shared storage
    const registry = new RegistryService(testRoot);

    // Add test data
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

    await registry.pushManifest('python', '3.11', manifest);
    await registry.pushManifest('python', '3.10', manifest);
    await registry.pushManifest('nodejs', '20', manifest);

    // Set up Express app
    app = express();
    app.use(express.json());
    app.use('/api/v1/registry/tags', tagsRouter);
  });

  afterAll(() => {
    // Clean up environment variable
    delete process.env.CODEPOD_REGISTRY_STORAGE;
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  describe('GET /api/v1/registry/tags', () => {
    test('should return all tags with image names', async () => {
      const response = await request(app).get('/api/v1/registry/tags');
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('tags');
      expect(Array.isArray(response.body.tags)).toBe(true);

      const tagNames = response.body.tags.map((t: { name: string }) => t.name);
      expect(tagNames).toContain('python:3.11');
      expect(tagNames).toContain('python:3.10');
      expect(tagNames).toContain('nodejs:20');
    });
  });

  describe('GET /api/v1/registry/tags/:name', () => {
    test('should return tag details with manifest', async () => {
      const response = await request(app).get('/api/v1/registry/tags/python:3.11');
      expect(response.status).toBe(200);
      expect(response.body.name).toBe('python:3.11');
      expect(response.body.manifest).toBeDefined();
      expect(response.body.manifest.schemaVersion).toBe(2);
    });

    test('should return 404 for non-existent tag', async () => {
      const response = await request(app).get('/api/v1/registry/tags/python:999.0');
      expect(response.status).toBe(404);
    });

    test('should return 400 for invalid tag name format', async () => {
      const response = await request(app).get('/api/v1/registry/tags/invalid');
      expect(response.status).toBe(400);
    });
  });

  describe('DELETE /api/v1/registry/tags/:name', () => {
    test('should delete tag', async () => {
      // First add a test tag to delete
      const registry = new RegistryService(testRoot);
      const manifest = { schemaVersion: 2, layers: [] };
      await registry.pushManifest('test-repo', 'to-delete', manifest as any);

      const response = await request(app).delete('/api/v1/registry/tags/test-repo:to-delete');
      expect(response.status).toBe(200);
      expect(response.body.message).toContain('deleted');

      // Verify deleted
      const getResponse = await request(app).get('/api/v1/registry/tags/test-repo:to-delete');
      expect(getResponse.status).toBe(404);
    });
  });
});
