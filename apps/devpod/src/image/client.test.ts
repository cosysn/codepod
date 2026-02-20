import { RegistryClient } from './client';
import { ResolvedImage } from './types';

// Mock fetch globally
global.fetch = jest.fn();

describe('RegistryClient', () => {
  let client: RegistryClient;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    client = new RegistryClient();
    mockFetch = global.fetch as jest.Mock;
    mockFetch.mockReset();
  });

  test('should create client', () => {
    expect(client).toBeDefined();
  });

  describe('exists()', () => {
    test('should return true when manifest exists', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ schemaVersion: 2 }),
      });

      const image: ResolvedImage = {
        originalName: 'python:3.11',
        fullName: 'docker.io/library/python:3.11',
        registry: 'docker.io',
        repository: 'library/python',
        tag: '3.11',
        useCache: false,
      };

      const result = await client.exists(image);
      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test('should return false when manifest does not exist', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found',
      });

      const image: ResolvedImage = {
        originalName: 'python:3.11',
        fullName: 'docker.io/library/python:3.11',
        registry: 'docker.io',
        repository: 'library/python',
        tag: '3.11',
        useCache: false,
      };

      const result = await client.exists(image);
      expect(result).toBe(false);
    });
  });

  describe('fetchManifest()', () => {
    test('should fetch manifest successfully', async () => {
      const manifest = { schemaVersion: 2, mediaType: 'application/json' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(manifest),
      });

      const image: ResolvedImage = {
        originalName: 'python:3.11',
        fullName: 'docker.io/library/python:3.11',
        registry: 'docker.io',
        repository: 'library/python',
        tag: '3.11',
        useCache: false,
      };

      const result = await client.fetchManifest(image);
      expect(result).toEqual(manifest);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://index.docker.io/v2/library/python/manifests/3.11',
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: 'application/vnd.oci.image.manifest.v1+json',
          }),
        })
      );
    });

    test('should throw error when fetch fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found',
      });

      const image: ResolvedImage = {
        originalName: 'python:3.11',
        fullName: 'docker.io/library/python:3.11',
        registry: 'docker.io',
        repository: 'library/python',
        tag: '3.11',
        useCache: false,
      };

      await expect(client.fetchManifest(image)).rejects.toThrow('Failed to fetch manifest: Not Found');
    });
  });

  describe('fetchBlob()', () => {
    test('should fetch blob successfully', async () => {
      const blobData = new Uint8Array([1, 2, 3, 4]);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(blobData.buffer),
      });

      const image: ResolvedImage = {
        originalName: 'python:3.11',
        fullName: 'docker.io/library/python:3.11',
        registry: 'docker.io',
        repository: 'library/python',
        tag: '3.11',
        digest: 'sha256:abc123',
        useCache: false,
      };

      const result = await client.fetchBlob(image);
      expect(result).toBeInstanceOf(Buffer);
      expect(result.toJSON().data).toEqual([1, 2, 3, 4]);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://index.docker.io/v2/library/python/blobs/sha256:abc123',
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: 'application/vnd.oci.image.manifest.v1+json',
          }),
        })
      );
    });

    test('should throw error when digest is missing', async () => {
      const image: ResolvedImage = {
        originalName: 'python:3.11',
        fullName: 'docker.io/library/python:3.11',
        registry: 'docker.io',
        repository: 'library/python',
        tag: '3.11',
        useCache: false,
      };

      await expect(client.fetchBlob(image)).rejects.toThrow('Digest required for blob URL');
    });

    test('should throw error when fetch fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Unauthorized',
      });

      const image: ResolvedImage = {
        originalName: 'python:3.11',
        fullName: 'docker.io/library/python:3.11',
        registry: 'docker.io',
        repository: 'library/python',
        tag: '3.11',
        digest: 'sha256:abc123',
        useCache: false,
      };

      await expect(client.fetchBlob(image)).rejects.toThrow('Failed to fetch blob: Unauthorized');
    });
  });
});
