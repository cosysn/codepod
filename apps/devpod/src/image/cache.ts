import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { ResolvedImage } from './types';

export class CacheManager {
  private cacheDir: string;

  constructor(cacheDir?: string) {
    this.cacheDir = cacheDir || path.join(process.env.HOME || '/root', '.devpod', 'cache');
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  async exists(image: ResolvedImage): Promise<boolean> {
    const manifestPath = this.getManifestPath(image);
    return fs.existsSync(manifestPath);
  }

  async storeBlob(image: ResolvedImage, content: Buffer): Promise<string> {
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    const blobPath = this.getBlobPath(hash);
    fs.mkdirSync(path.dirname(blobPath), { recursive: true });
    fs.writeFileSync(blobPath, content);

    // Also store manifest to mark image as cached
    const manifestPath = this.getManifestPath(image);
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify({ digest: `sha256:${hash}`, cachedAt: new Date().toISOString() }));

    return `sha256:${hash}`;
  }

  async storeManifest(image: ResolvedImage, manifest: any): Promise<void> {
    const manifestPath = this.getManifestPath(image);
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  }

  async getManifest(image: ResolvedImage): Promise<any> {
    const manifestPath = this.getManifestPath(image);
    if (!fs.existsSync(manifestPath)) {
      throw new Error('Manifest not found');
    }
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  }

  async listRepositories(): Promise<string[]> {
    const reposDir = path.join(this.cacheDir, 'manifests', 'repositories');
    if (!fs.existsSync(reposDir)) {
      return [];
    }
    return fs.readdirSync(reposDir);
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
