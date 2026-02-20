/**
 * Unit tests for StorageService
 */

import * as fs from 'fs';
import * as path from 'path';
import { StorageService } from './storage';

describe('StorageService', () => {
  let storage: StorageService;
  const testRoot = '/tmp/test-registry-' + Date.now();

  beforeAll(() => {
    storage = new StorageService(testRoot);
  });

  afterAll(() => {
    // Cleanup
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  describe('initialization', () => {
    test('should initialize storage directory structure', () => {
      expect(fs.existsSync(path.join(testRoot, 'blobs'))).toBe(true);
      expect(fs.existsSync(path.join(testRoot, 'manifests'))).toBe(true);
      expect(fs.existsSync(path.join(testRoot, 'blobs', 'sha256'))).toBe(true);
      expect(fs.existsSync(path.join(testRoot, 'manifests', 'repositories'))).toBe(true);
    });
  });

  describe('blob operations', () => {
    test('should store and retrieve blob', async () => {
      const content = Buffer.from('test blob content for sha256');
      const digest = await storage.storeBlob('sha256', content);
      expect(digest).toMatch(/^sha256:[a-f0-9]{64}$/);

      const retrieved = await storage.getBlob(digest);
      expect(retrieved.toString()).toBe('test blob content for sha256');
    });

    test('should store blob with sha512', async () => {
      const content = Buffer.from('sha512 test content');
      const digest = await storage.storeBlob('sha512', content);
      expect(digest).toMatch(/^sha512:[a-f0-9]{128}$/);

      const retrieved = await storage.getBlob(digest);
      expect(retrieved.toString()).toBe('sha512 test content');
    });

    test('should throw error for non-existent blob', async () => {
      await expect(storage.getBlob('sha256:nonexistent12345678901234567890123456789012345678901234'))
        .rejects.toThrow('Blob not found');
    });

    test('should check blob existence', async () => {
      const content = Buffer.from('existence test');
      const digest = await storage.storeBlob('sha256', content);

      const exists = await storage.blobExists(digest);
      expect(exists).toBe(true);

      const notExists = await storage.blobExists('sha256:nonexistent12345678901234567890123456789012345678901234');
      expect(notExists).toBe(false);
    });
  });

  describe('manifest operations', () => {
    test('should store and retrieve manifest', async () => {
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

      const digest = await storage.storeManifest('python', '3.11', manifest);
      expect(digest).toMatch(/^sha256:/);

      const retrieved = await storage.getManifest('python', '3.11');
      expect(retrieved).toEqual(manifest);
    });

    test('should store multiple tags for same repository', async () => {
      const manifest = { schemaVersion: 2, layers: [] };

      await storage.storeManifest('nodejs', '18', manifest as any);
      await storage.storeManifest('nodejs', '20', manifest as any);
      await storage.storeManifest('nodejs', 'latest', manifest as any);

      const tags18 = await storage.getManifest('nodejs', '18');
      const tags20 = await storage.getManifest('nodejs', '20');
      const tagsLatest = await storage.getManifest('nodejs', 'latest');

      expect(tags18).toEqual(manifest);
      expect(tags20).toEqual(manifest);
      expect(tagsLatest).toEqual(manifest);
    });

    test('should throw error for non-existent manifest', async () => {
      await expect(storage.getManifest('nonexistent', 'latest'))
        .rejects.toThrow('Manifest not found');
    });

    test('should delete manifest', async () => {
      const manifest = { schemaVersion: 2, layers: [] };

      // Store and get the actual digest
      const digest = await storage.storeManifest('golang', '1.21', manifest);

      // Verify exists by checking blob
      const existsBefore = await storage.blobExists(digest);
      expect(existsBefore).toBe(true);

      // Delete
      await storage.deleteManifest('golang', '1.21');

      // Verify deleted - reference file should not exist
      await expect(storage.getManifest('golang', '1.21'))
        .rejects.toThrow('Manifest not found');
    });
  });

  describe('repository listing', () => {
    beforeAll(async () => {
      // Create some test repositories
      await storage.storeManifest('ubuntu', 'latest', { schemaVersion: 2, layers: [] } as any);
      await storage.storeManifest('debian', 'bookworm', { schemaVersion: 2, layers: [] } as any);
      await storage.storeManifest('alpine', 'latest', { schemaVersion: 2, layers: [] } as any);
    });

    test('should list repositories', async () => {
      const repos = await storage.listRepositories();
      expect(repos).toContain('ubuntu');
      expect(repos).toContain('debian');
      expect(repos).toContain('alpine');
    });

    test('should list tags for repository', async () => {
      const tags = await storage.listTags('ubuntu');
      expect(tags).toContain('latest');

      const debianTags = await storage.listTags('debian');
      expect(debianTags).toContain('bookworm');
    });

    test('should return empty array for non-existent repository', async () => {
      const tags = await storage.listTags('nonexistent-repo');
      expect(tags).toEqual([]);
    });
  });
});
