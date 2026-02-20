/**
 * RegistryService - Core registry operations
 */

import { StorageService } from './storage';
import { Manifest } from '../types/registry';

export class RegistryService {
  private storage: StorageService;

  constructor(storageRoot?: string) {
    this.storage = new StorageService(storageRoot);
  }

  /**
   * Push a manifest to the registry
   */
  async pushManifest(repository: string, ref: string, manifest: Manifest): Promise<string> {
    return this.storage.storeManifest(repository, ref, manifest);
  }

  /**
   * Pull a manifest from the registry
   */
  async pullManifest(repository: string, ref: string): Promise<Manifest> {
    return this.storage.getManifest(repository, ref);
  }

  /**
   * Delete a manifest (tag)
   */
  async deleteManifest(repository: string, ref: string): Promise<void> {
    return this.storage.deleteManifest(repository, ref);
  }

  /**
   * List all repositories
   */
  async listRepositories(): Promise<string[]> {
    return this.storage.listRepositories();
  }

  /**
   * List all tags for a repository
   */
  async listTags(repository: string): Promise<string[]> {
    return this.storage.listTags(repository);
  }

  /**
   * Check if a blob exists
   */
  async blobExists(digest: string): Promise<boolean> {
    return this.storage.blobExists(digest);
  }

  /**
   * Get a blob by digest
   */
  async getBlob(digest: string): Promise<Buffer> {
    return this.storage.getBlob(digest);
  }

  /**
   * Store a blob
   */
  async storeBlob(content: Buffer): Promise<string> {
    return this.storage.storeBlob('sha256', content);
  }

  /**
   * Check registry health
   */
  async checkHealth(): Promise<{ status: string; storageRoot: string }> {
    return {
      status: 'healthy',
      storageRoot: this.storage.getRootPath(),
    };
  }

  /**
   * Get storage service (for advanced operations)
   */
  getStorage(): StorageService {
    return this.storage;
  }
}
