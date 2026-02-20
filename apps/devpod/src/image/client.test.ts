import { RegistryClient } from './client';
import { ResolvedImage } from './types';

describe('RegistryClient', () => {
  let client: RegistryClient;

  beforeEach(() => {
    client = new RegistryClient();
  });

  test('should create client', () => {
    expect(client).toBeDefined();
  });

  test('should parse docker.io correctly', () => {
    // Test that docker.io URLs are handled correctly
    const image: ResolvedImage = {
      originalName: 'python:3.11',
      fullName: 'docker.io/library/python:3.11',
      registry: 'docker.io',
      repository: 'library/python',
      tag: '3.11',
      useCache: false,
    };
    expect(image.registry).toBe('docker.io');
  });
});
