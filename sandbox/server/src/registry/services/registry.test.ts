/**
 * Unit tests for RegistryService
 */

import * as fs from 'fs';
import * as path from 'path';
import { RegistryService } from './registry';

describe('RegistryService', () => {
  let registry: RegistryService;
  const testRoot = '/tmp/test-registry-service-' + Date.now();

  beforeAll(() => {
    registry = new RegistryService(testRoot);
  });

  afterAll(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  describe('manifest operations', () => {
    test('should push and pull manifest', async () => {
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

      // Push
      const digest = await registry.pushManifest('python', '3.11', manifest);
      expect(digest).toMatch(/^sha256:/);

      // Pull
      const pulled = await registry.pullManifest('python', '3.11');
      expect(pulled).toEqual(manifest);
    });

    test('should list repositories', async () => {
      const repos = await registry.listRepositories();
      expect(repos).toContain('python');
    });

    test('should list tags', async () => {
      const tags = await registry.listTags('python');
      expect(tags).toContain('3.11');
    });

    test('should delete manifest', async () => {
      await registry.deleteManifest('python', '3.11');

      const tags = await registry.listTags('python');
      expect(tags).not.toContain('3.11');
    });
  });

  describe('blob operations', () => {
    test('should check blob existence', async () => {
      const content = Buffer.from('test content for blob');
      const digest = await registry.storeBlob(content);

      const exists = await registry.blobExists(digest);
      expect(exists).toBe(true);

      const notExists = await registry.blobExists('sha256:nonexistent');
      expect(notExists).toBe(false);
    });

    test('should get blob', async () => {
      const content = Buffer.from('blob content');
      const digest = await registry.storeBlob(content);

      const blob = await registry.getBlob(digest);
      expect(blob.toString()).toBe('blob content');
    });
  });

  describe('health check', () => {
    test('should return healthy status', async () => {
      const status = await registry.checkHealth();
      expect(status.status).toBe('healthy');
    });
  });
});
