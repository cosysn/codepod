import * as fs from 'fs';
import { CacheManager } from './cache';
import { ResolvedImage } from './types';

describe('CacheManager', () => {
  let cache: CacheManager;
  const testCacheDir = '/tmp/test-image-cache-' + Date.now();

  beforeEach(async () => {
    cache = new CacheManager(testCacheDir);
    await cache.initialize();
  });

  afterEach(() => {
    fs.rmSync(testCacheDir, { recursive: true, force: true });
  });

  test('should create cache directory on initialize', async () => {
    const newCacheDir = '/tmp/test-image-cache-init-' + Date.now();
    const newCache = new CacheManager(newCacheDir);
    expect(fs.existsSync(newCacheDir)).toBe(false);
    await newCache.initialize();
    expect(fs.existsSync(newCacheDir)).toBe(true);
    fs.rmSync(newCacheDir, { recursive: true, force: true });
  });

  test('should store and check blob existence', async () => {
    const image: ResolvedImage = {
      originalName: 'python:3.11',
      fullName: 'localhost:5000/python:3.11',
      registry: 'localhost:5000',
      repository: 'python',
      tag: '3.11',
      useCache: true,
    };

    const content = Buffer.from('test blob content');
    await cache.storeBlob(image, content);

    const exists = await cache.exists(image);
    expect(exists).toBe(true);
  });

  test('should list repositories', async () => {
    const image1: ResolvedImage = {
      originalName: 'python:3.11',
      fullName: 'localhost:5000/python:3.11',
      registry: 'localhost:5000',
      repository: 'python',
      tag: '3.11',
      useCache: true,
    };
    await cache.storeBlob(image1, Buffer.from('content'));

    const repos = await cache.listRepositories();
    expect(repos).toContain('python');
  });

  test('should store and retrieve manifest', async () => {
    const image: ResolvedImage = {
      originalName: 'node:20',
      fullName: 'localhost:5000/node:20',
      registry: 'localhost:5000',
      repository: 'node',
      tag: '20',
      useCache: true,
    };

    const manifest = { digest: 'sha256:abc123', cachedAt: new Date().toISOString() };
    await cache.storeManifest(image, manifest);

    const retrieved = await cache.getManifest(image);
    expect(retrieved.digest).toBe(manifest.digest);
    expect(retrieved.cachedAt).toBe(manifest.cachedAt);
  });

  test('should throw error when manifest not found', async () => {
    const image: ResolvedImage = {
      originalName: 'nonexistent:tag',
      fullName: 'localhost:5000/nonexistent:tag',
      registry: 'localhost:5000',
      repository: 'nonexistent',
      tag: 'tag',
      useCache: true,
    };

    await expect(cache.getManifest(image)).rejects.toThrow('Manifest not found');
  });
});
