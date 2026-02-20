import { ImageResolver } from './resolver';
import { ResolvedImage } from './types';

describe('ImageResolver', () => {
  let resolver: ImageResolver;

  beforeEach(() => {
    resolver = new ImageResolver({
      preferCache: true,
      cacheRegistry: 'localhost:5000',
      fallbackRegistries: ['docker.io'],
      prefixMappings: {},
    });
  });

  test('should resolve simple image', () => {
    const result = resolver.resolve('python:3.11');
    expect(result.repository).toBe('python');
    expect(result.tag).toBe('3.11');
    expect(result.registry).toBe('docker.io');
    expect(result.useCache).toBe(false);
  });

  test('should resolve localhost registry image', () => {
    const result = resolver.resolve('localhost:5000/my-app:v1');
    expect(result.registry).toBe('localhost:5000');
    expect(result.useCache).toBe(true);
  });

  test('should apply prefix mapping', () => {
    resolver = new ImageResolver({
      preferCache: true,
      cacheRegistry: 'localhost:5000',
      fallbackRegistries: ['docker.io'],
      prefixMappings: {
        'my-app': 'localhost:5000/my-org/my-app',
      },
    });

    const result = resolver.resolve('my-app:v1');
    expect(result.fullName).toBe('localhost:5000/my-org/my-app:v1');
    expect(result.useCache).toBe(true);
  });

  test('should NOT apply prefix mapping when explicit registry is specified', () => {
    resolver = new ImageResolver({
      preferCache: true,
      cacheRegistry: 'localhost:5000',
      fallbackRegistries: ['docker.io'],
      prefixMappings: {
        'my-app': 'localhost:5000/my-org/my-app',
      },
    });

    const result = resolver.resolve('gcr.io/my-app:v1');
    expect(result.fullName).toBe('gcr.io/my-app:v1');
    expect(result.registry).toBe('gcr.io');
    expect(result.useCache).toBe(false);
  });

  test('should throw error for empty image name', () => {
    expect(() => resolver.resolve('')).toThrow('Image name cannot be empty');
    expect(() => resolver.resolve('   ')).toThrow('Image name cannot be empty');
  });

  test('should throw error for non-string input', () => {
    expect(() => resolver.resolve(undefined as unknown as string)).toThrow('Image name cannot be empty');
    expect(() => resolver.resolve(null as unknown as string)).toThrow('Image name cannot be empty');
  });
});
