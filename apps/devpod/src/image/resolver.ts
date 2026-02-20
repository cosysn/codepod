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
    // Input validation
    if (!imageName || typeof imageName !== 'string' || imageName.trim() === '') {
      throw new Error('Image name cannot be empty');
    }

    const parsed = this.parser.parse(imageName);

    // Check prefix mappings - only apply if no explicit registry was specified
    // (i.e., using default Docker Hub)
    const hasExplicitRegistry = parsed.registry && parsed.registry !== 'docker.io';
    if (!hasExplicitRegistry && this.config.prefixMappings[parsed.repository]) {
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

    // Docker Hub official images - use preferCache setting
    if (!parsed.registry || parsed.registry === 'docker.io') {
      const fullImage = this.parser.parse(`docker.io/${parsed.repository}:${parsed.tag}`);
      // When preferCache is true, try to use internal registry cache first
      // Map to internal registry path for caching
      const cacheRepo = `${this.config.cacheRegistry}/${parsed.repository}`;
      const cachedImage = this.parser.parse(`${cacheRepo}:${parsed.tag}`);
      return {
        ...cachedImage,
        originalName: imageName,
        registry: this.config.preferCache ? this.config.cacheRegistry : 'docker.io',
        useCache: this.config.preferCache,
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
        // Image found in cache - use internal registry
        return image;
      }

      // Not in cache - need to pull from external registry
      // Create source image reference for pulling
      const sourceImage: ResolvedImage = {
        ...image,
        registry: this.getExternalRegistry(image.originalName),
      };

      // Pull from external to cache
      await this.pullToCache(sourceImage, image);

      // Return the cached image path
      return image;
    }

    return image;
  }

  /**
   * Get the external registry URL for an image
   */
  private getExternalRegistry(imageName: string): string {
    const parsed = this.parser.parse(imageName);
    if (parsed.registry && parsed.registry !== 'docker.io' && parsed.registry !== this.config.cacheRegistry) {
      return parsed.registry;
    }
    return 'docker.io';
  }

  async pullToCache(sourceImage: ResolvedImage, cachedImage: ResolvedImage): Promise<void> {
    try {
      // Fetch manifest from external registry
      const manifest = await this.client.fetchManifest(sourceImage);

      // Store manifest in cache
      await this.cache.storeManifest(cachedImage, manifest);

      // TODO: Pull and store all blobs to fully cache the image
      // For now, we store the manifest which marks the image as cached
    } catch (error) {
      console.error(`Failed to pull image to cache: ${error}`);
      throw error;
    }
  }

  async listCachedImages(): Promise<string[]> {
    return this.cache.listRepositories();
  }
}
