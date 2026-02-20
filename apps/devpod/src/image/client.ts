// apps/devpod/src/image/client.ts

import { ResolvedImage } from './types';

export class RegistryClient {
  private tokenCache: Map<string, string> = new Map();

  /**
   * Check if image exists in registry
   */
  async exists(image: ResolvedImage): Promise<boolean> {
    try {
      await this.fetchManifest(image);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Fetch manifest from registry
   */
  async fetchManifest(image: ResolvedImage): Promise<any> {
    const url = this.buildManifestUrl(image);
    const response = await fetch(url, {
      headers: this.getAuthHeaders(image),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch manifest: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Fetch blob from registry
   */
  async fetchBlob(image: ResolvedImage): Promise<Buffer> {
    const url = this.buildBlobUrl(image);
    const response = await fetch(url, {
      headers: this.getAuthHeaders(image),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch blob: ${response.statusText}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  private buildManifestUrl(image: ResolvedImage): string {
    const registry = image.registry === 'docker.io' ? 'index.docker.io' : image.registry;
    const repo = image.repository;
    return `https://${registry}/v2/${repo}/manifests/${image.tag}`;
  }

  private buildBlobUrl(image: ResolvedImage): string {
    if (!image.digest) {
      throw new Error('Digest required for blob URL');
    }
    const registry = image.registry === 'docker.io' ? 'index.docker.io' : image.registry;
    const repo = image.repository;
    return `https://${registry}/v2/${repo}/blobs/${image.digest}`;
  }

  private getAuthHeaders(image: ResolvedImage): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.oci.image.manifest.v1+json',
    };

    // For docker.io, try to get token
    if (image.registry === 'docker.io') {
      // Basic auth for docker hub
      // In production, use proper token handling
    }

    return headers;
  }
}
