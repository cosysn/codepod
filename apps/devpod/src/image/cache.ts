import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { ResolvedImage } from './types';

export interface CacheManifest {
  digest: string;
  cachedAt: string;
}

export class CacheManager {
  private cacheDir: string;

  constructor(cacheDir?: string) {
    this.cacheDir = cacheDir || path.join(process.env.HOME || '/root', '.devpod', 'cache');
  }

  async initialize(): Promise<void> {
    await fs.promises.mkdir(this.cacheDir, { recursive: true });
  }

  async exists(image: ResolvedImage): Promise<boolean> {
    const manifestPath = this.getManifestPath(image);
    return fs.promises.access(manifestPath).then(() => true).catch(() => false);
  }

  async storeBlob(image: ResolvedImage, content: Buffer): Promise<string> {
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    const blobPath = this.getBlobPath(hash);
    const manifestPath = this.getManifestPath(image);

    // Ensure directories exist (handles race condition better than individual mkdirSync calls)
    await fs.promises.mkdir(path.dirname(blobPath), { recursive: true });
    await fs.promises.mkdir(path.dirname(manifestPath), { recursive: true });

    // Store blob and manifest in parallel
    const blobWrite = fs.promises.writeFile(blobPath, content);
    const manifest: CacheManifest = {
      digest: `sha256:${hash}`,
      cachedAt: new Date().toISOString(),
    };
    const manifestWrite = fs.promises.writeFile(manifestPath, JSON.stringify(manifest));

    await Promise.all([blobWrite, manifestWrite]);

    return `sha256:${hash}`;
  }

  async storeManifest(image: ResolvedImage, manifest: CacheManifest): Promise<void> {
    const manifestPath = this.getManifestPath(image);
    await fs.promises.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.promises.writeFile(manifestPath, JSON.stringify(manifest));
  }

  async getManifest(image: ResolvedImage): Promise<CacheManifest> {
    const manifestPath = this.getManifestPath(image);
    try {
      const content = await fs.promises.readFile(manifestPath, 'utf-8');
      return JSON.parse(content) as CacheManifest;
    } catch (error) {
      throw new Error(`Manifest not found for image ${image.fullName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async listRepositories(): Promise<string[]> {
    const reposDir = path.join(this.cacheDir, 'manifests', 'repositories');
    try {
      const entries = await fs.promises.readdir(reposDir);
      const results: string[] = [];
      for (const entry of entries) {
        const stat = await fs.promises.stat(path.join(reposDir, entry));
        if (stat.isDirectory()) {
          results.push(entry);
        }
      }
      return results;
    } catch {
      return [];
    }
  }

  private getManifestPath(image: ResolvedImage): string {
    return path.join(
      this.cacheDir,
      'manifests',
      'repositories',
      image.repository,
      'tags',
      image.tag
    );
  }

  private getBlobPath(digest: string): string {
    const hash = digest.replace('sha256:', '');
    return path.join(this.cacheDir, 'blobs', 'sha256', hash.substring(0, 2), hash.substring(2));
  }
}
