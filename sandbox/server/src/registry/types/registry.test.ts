/**
 * Unit tests for registry types
 */

import { Image, Tag, Manifest, ExternalRegistry } from './registry';

describe('Registry Types', () => {
  describe('Image', () => {
    test('should have required fields', () => {
      const image: Image = {
        name: 'python',
        tags: ['3.11', '3.10'],
        createdAt: new Date(),
        updatedAt: new Date(),
        size: 1024,
      };
      expect(image.name).toBe('python');
      expect(image.tags).toContain('3.11');
      expect(image.tags).toContain('3.10');
    });

    test('should allow optional manifest field', () => {
      const manifest: Manifest = {
        schemaVersion: 2,
        mediaType: 'application/vnd.oci.image.manifest.v1+json',
        config: {
          mediaType: 'application/vnd.oci.image.config.v1+json',
          digest: 'sha256:abc123',
          size: 100,
        },
        layers: [],
      };

      const image: Image = {
        name: 'python',
        tags: ['latest'],
        createdAt: new Date(),
        updatedAt: new Date(),
        size: 1024,
        manifest,
      };

      expect(image.manifest).toBeDefined();
      expect(image.manifest?.schemaVersion).toBe(2);
    });
  });

  describe('Tag', () => {
    test('should have required fields', () => {
      const tag: Tag = {
        name: 'python:3.11',
        digest: 'sha256:abc123def456',
        createdAt: new Date(),
        size: 1024,
        architecture: 'amd64',
        os: 'linux',
        layers: 5,
      };
      expect(tag.name).toBe('python:3.11');
      expect(tag.digest).toMatch(/^sha256:/);
      expect(tag.architecture).toBe('amd64');
      expect(tag.os).toBe('linux');
      expect(tag.layers).toBe(5);
    });

    test('should allow different architectures', () => {
      const tag: Tag = {
        name: 'python:3.11',
        digest: 'sha256:abc123',
        createdAt: new Date(),
        size: 1024,
        architecture: 'arm64',
        os: 'linux',
        layers: 3,
      };
      expect(tag.architecture).toBe('arm64');
    });
  });

  describe('Manifest', () => {
    test('should have correct OCI manifest structure', () => {
      const manifest: Manifest = {
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

      expect(manifest.schemaVersion).toBe(2);
      expect(manifest.config.digest).toBe('sha256:config123');
      expect(manifest.layers).toHaveLength(1);
      expect(manifest.layers[0].mediaType).toBe('application/vnd.oci.image.layer.v1.tar+gzip');
    });

    test('should support optional annotations', () => {
      const manifest: Manifest = {
        schemaVersion: 2,
        mediaType: 'application/vnd.oci.image.manifest.v1+json',
        config: {
          mediaType: 'application/vnd.oci.image.config.v1+json',
          digest: 'sha256:config123',
          size: 100,
        },
        layers: [],
        annotations: {
          'org.opencontainers.image.source': 'https://github.com/example/repo',
        },
      };

      expect(manifest.annotations).toBeDefined();
      expect(manifest.annotations?.['org.opencontainers.image.source']).toBe('https://github.com/example/repo');
    });
  });

  describe('ExternalRegistry', () => {
    test('should have harbor type configuration', () => {
      const registry: ExternalRegistry = {
        id: 'harbor-123',
        name: 'Harbor (harbor.example.com)',
        type: 'harbor',
        endpoint: 'https://harbor.example.com',
        auth: {
          type: 'basic',
          username: 'admin',
          password: 'password123',
        },
        insecure: false,
        createdAt: new Date(),
      };

      expect(registry.type).toBe('harbor');
      expect(registry.endpoint).toBe('https://harbor.example.com');
      expect(registry.auth.type).toBe('basic');
    });

    test('should have dockerhub type configuration', () => {
      const registry: ExternalRegistry = {
        id: 'dockerhub-456',
        name: 'Docker Hub',
        type: 'dockerhub',
        endpoint: 'https://index.docker.io/v1/',
        auth: {
          type: 'bearer',
          registryToken: 'token123',
        },
        insecure: false,
        createdAt: new Date(),
      };

      expect(registry.type).toBe('dockerhub');
      expect(registry.auth.type).toBe('bearer');
    });

    test('should support insecure option for HTTP registries', () => {
      const registry: ExternalRegistry = {
        id: 'custom-789',
        name: 'Local Registry',
        type: 'custom',
        endpoint: 'http://localhost:5000',
        auth: {
          type: 'basic',
          username: 'user',
          password: 'pass',
        },
        insecure: true,
        createdAt: new Date(),
      };

      expect(registry.insecure).toBe(true);
    });
  });
});
