/**
 * StorageService - Handles blob and manifest storage for the registry
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export class StorageService {
  private root: string;
  private blobsDir: string;
  private manifestsDir: string;

  constructor(root: string = './data/registry') {
    this.root = root;
    this.blobsDir = path.join(root, 'blobs');
    this.manifestsDir = path.join(root, 'manifests');
    this.initialize();
  }

  /**
   * Initialize storage directory structure
   */
  private initialize(): void {
    const dirs = [
      this.root,
      this.blobsDir,
      path.join(this.blobsDir, 'sha256'),
      path.join(this.blobsDir, 'sha512'),
      this.manifestsDir,
      path.join(this.manifestsDir, 'repositories'),
      path.join(this.manifestsDir, 'tags'),
    ];
    for (const dir of dirs) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Store a blob and return its digest
   */
  async storeBlob(alg: string, content: Buffer): Promise<string> {
    const hash = crypto.createHash(alg.replace('-', ''));
    hash.update(content);
    const digest = `${alg}:${hash.digest('hex')}`;

    const digestPath = this.getDigestPath(digest);
    fs.mkdirSync(path.dirname(digestPath), { recursive: true });
    fs.writeFileSync(digestPath, content);

    return digest;
  }

  /**
   * Retrieve a blob by its digest
   */
  async getBlob(digest: string): Promise<Buffer> {
    const digestPath = this.getDigestPath(digest);
    if (!fs.existsSync(digestPath)) {
      throw new Error(`Blob not found: ${digest}`);
    }
    return fs.readFileSync(digestPath);
  }

  /**
   * Check if a blob exists
   */
  async blobExists(digest: string): Promise<boolean> {
    const digestPath = this.getDigestPath(digest);
    return fs.existsSync(digestPath);
  }

  /**
   * Store a manifest and return its digest
   */
  async storeManifest(repository: string, ref: string, manifest: any): Promise<string> {
    const content = Buffer.from(JSON.stringify(manifest));
    const digest = await this.storeBlob('sha256', content);

    // Store by reference (tag)
    const refPath = this.getManifestRefPath(repository, ref);
    fs.mkdirSync(path.dirname(refPath), { recursive: true });
    fs.writeFileSync(refPath, digest);

    return digest;
  }

  /**
   * Retrieve a manifest by repository and reference (tag or digest)
   */
  async getManifest(repository: string, ref: string): Promise<any> {
    const refPath = this.getManifestRefPath(repository, ref);

    // First try to read as a reference file
    if (fs.existsSync(refPath)) {
      const digest = fs.readFileSync(refPath, 'utf-8').trim();
      const blob = await this.getBlob(digest);
      return JSON.parse(blob.toString());
    }

    // If ref looks like a digest, try to get the blob directly
    if (ref.startsWith('sha256:') || ref.startsWith('sha512:')) {
      try {
        const blob = await this.getBlob(ref);
        return JSON.parse(blob.toString());
      } catch {
        // Not a valid digest
      }
    }

    throw new Error(`Manifest not found: ${repository}:${ref}`);
  }

  /**
   * Delete a manifest reference
   */
  async deleteManifest(repository: string, ref: string): Promise<void> {
    const refPath = this.getManifestRefPath(repository, ref);
    if (fs.existsSync(refPath)) {
      fs.rmSync(refPath);
    }
  }

  /**
   * List all repositories
   */
  async listRepositories(): Promise<string[]> {
    const reposDir = path.join(this.manifestsDir, 'repositories');
    if (!fs.existsSync(reposDir)) {
      return [];
    }
    return fs.readdirSync(reposDir);
  }

  /**
   * List all tags for a repository
   */
  async listTags(repository: string): Promise<string[]> {
    const tagsDir = path.join(this.manifestsDir, 'repositories', repository, 'tags');
    if (!fs.existsSync(tagsDir)) {
      return [];
    }
    return fs.readdirSync(tagsDir);
  }

  /**
   * Get the storage root path
   */
  getRootPath(): string {
    return this.root;
  }

  /**
   * Get blob path from digest
   */
  private getDigestPath(digest: string): string {
    const parts = digest.split(':');
    if (parts.length !== 2) {
      throw new Error(`Invalid digest format: ${digest}`);
    }
    const [alg, hash] = parts;
    if (alg === 'sha256') {
      return path.join(this.blobsDir, 'sha256', hash.substring(0, 2), hash.substring(2));
    } else if (alg === 'sha512') {
      return path.join(this.blobsDir, 'sha512', hash.substring(0, 2), hash.substring(2));
    }
    throw new Error(`Unsupported algorithm: ${alg}`);
  }

  /**
   * Get manifest reference file path
   */
  private getManifestRefPath(repository: string, ref: string): string {
    return path.join(this.manifestsDir, 'repositories', repository, 'tags', ref);
  }
}
