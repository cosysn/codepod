import { ResolvedImage, RegistryConfig } from './types';

describe('Image Types', () => {
  test('ResolvedImage should have required fields', () => {
    const image: ResolvedImage = {
      originalName: 'python:3.11',
      fullName: 'docker.io/library/python:3.11',
      registry: 'docker.io',
      repository: 'library/python',
      tag: '3.11',
      useCache: false,
    };
    expect(image.originalName).toBe('python:3.11');
    expect(image.registry).toBe('docker.io');
    expect(image.useCache).toBe(false);
  });

  test('RegistryConfig should have required fields', () => {
    const config: RegistryConfig = {
      name: 'localhost',
      endpoint: 'http://localhost:5000',
      insecure: true,
      priority: 1,
    };
    expect(config.endpoint).toBe('http://localhost:5000');
    expect(config.priority).toBe(1);
  });
});
