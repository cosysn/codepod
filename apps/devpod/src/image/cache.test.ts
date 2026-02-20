import * as fs from 'fs';
import { CacheManager } from './cache';
import { ResolvedImage } from './types';

describe('CacheManager', () => {
  let cache: CacheManager;
  const testCacheDir = '/tmp/test-image-cache-' + Date.now();

  beforeEach(() => {
    cache = new CacheManager(testCacheDir);
  });

  afterEach(() => {
    fs.rmSync(testCacheDir, { recursive: true, force: true });
  });

  test('should create cache directory', () => {
    expect(fs.existsSync(testCacheDir)).toBe(true);
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
});
