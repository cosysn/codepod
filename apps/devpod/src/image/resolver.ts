import { ImageParser } from './parser';
import { CacheManager } from './cache';
import { RegistryClient } from './client';
import { ResolvedImage, ImageResolverConfig } from './types';

export class ImageResolver {
  private parser: ImageParser;
  private cache: CacheManager;
  private client: RegistryClient;
  private config: ImageResolverConfig;

  constructor(config?: Partial<ImageResolverConfig>) {
    this.config = {
      preferCache: true,
      cacheRegistry: 'localhost:5000',
      fallbackRegistries: ['docker.io'],
      prefixMappings: {},
      ...config,
    };
    this.parser = new ImageParser();
    this.cache = new CacheManager();
    this.client = new RegistryClient();
  }

  resolve(imageName: string): ResolvedImage {
    const parsed = this.parser.parse(imageName);

    // Check prefix mappings
    if (this.config.prefixMappings[parsed.repository]) {
      const mapped = this.parser.parse(
        `${this.config.prefixMappings[parsed.repository]}:${parsed.tag}`
      );
      return {
        ...mapped,
        originalName: imageName,
        useCache: true,
      };
    }

    // Built-in registry images
    if (parsed.registry === 'localhost:5000' || parsed.registry === this.config.cacheRegistry) {
      return {
        ...parsed,
        originalName: imageName,
        useCache: true,
      };
    }

    // Docker Hub official images
    if (!parsed.registry || parsed.registry === 'docker.io') {
      const fullImage = this.parser.parse(`docker.io/${parsed.repository}:${parsed.tag}`);
      return {
        ...fullImage,
        originalName: imageName,
        registry: 'docker.io',
        useCache: false,
      };
    }

    // External registry
    return {
      ...parsed,
      originalName: imageName,
      useCache: false,
    };
  }

  async getImage(imageName: string): Promise<ResolvedImage> {
    const image = this.resolve(imageName);

    if (image.useCache) {
      const exists = await this.cache.exists(image);
      if (exists) {
        return image;
      }

      // Try to pull from external to cache
      if (image.registry !== this.config.cacheRegistry) {
        await this.pullToCache(image);
      }
    }

    return image;
  }

  async pullToCache(image: ResolvedImage): Promise<void> {
    // Implementation for pulling to cache
    const manifest = await this.client.fetchManifest(image);
    // Store manifest and blobs to cache
    await this.cache.storeManifest(image, manifest);
  }

  async listCachedImages(): Promise<string[]> {
    return this.cache.listRepositories();
  }
}
