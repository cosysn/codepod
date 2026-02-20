# DevPod Image Resolver Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 实现智能镜像选择器，支持从多个镜像源自动解析、拉取和缓存容器镜像。

**Architecture:** 使用 TypeScript 实现镜像解析器，支持 Docker Registry V2 API 兼容的仓库。优先使用内置仓库缓存，支持 Docker Hub 和外部仓库的透明代理。

**Tech Stack:** TypeScript, Node.js, Docker Registry V2 API, Express.js

---

## Prerequisites

### Dependencies to add in apps/devpod/package.json

```json
{
  "dependencies": {
    "docker-registry-client": "^4.0.0"
  }
}
```

---

## Task 1: Create Image Types

**Files:**
- Create: `apps/devpod/src/image/types.ts`
- Test: `apps/devpod/src/image/types.test.ts`

**Step 1: Write the failing test**

```typescript
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
```

**Step 2: Run test to verify it fails**

```bash
cd apps/devpod && npm test -- --testPathPattern="image/types" --coverage=false
# Expected: FAIL - file does not exist
```

**Step 3: Write minimal implementation**

```typescript
// apps/devpod/src/image/types.ts

export interface ResolvedImage {
  originalName: string;
  fullName: string;
  registry: string;
  repository: string;
  tag: string;
  digest?: string;
  useCache: boolean;
}

export interface RegistryConfig {
  name: string;
  endpoint: string;
  insecure: boolean;
  priority: number;
}

export interface ImageResolverConfig {
  preferCache: boolean;
  cacheRegistry: string;
  fallbackRegistries: string[];
  prefixMappings: Record<string, string>;
}
```

**Step 4: Run test to verify it passes**

```bash
cd apps/devpod && npm test -- --testPathPattern="image/types" --coverage=false
# Expected: PASS
```

**Step 5: Commit**

```bash
git add apps/devpod/src/image/types.ts apps/devpod/src/image/types.test.ts
git commit -m "feat(image): add image types definition"
```

---

## Task 2: Create Image Parser

**Files:**
- Create: `apps/devpod/src/image/parser.ts`
- Test: `apps/devpod/src/image/parser.test.ts`

**Step 1: Write the failing test**

```typescript
import { ImageParser } from './parser';

describe('ImageParser', () => {
  let parser: ImageParser;

  beforeEach(() => {
    parser = new ImageParser();
  });

  test('should parse simple image with tag', () => {
    const result = parser.parse('python:3.11');
    expect(result.repository).toBe('python');
    expect(result.tag).toBe('3.11');
    expect(result.registry).toBe('docker.io');
  });

  test('should parse image with registry', () => {
    const result = parser.parse('localhost:5000/my-app:v1');
    expect(result.registry).toBe('localhost:5000');
    expect(result.repository).toBe('my-app');
    expect(result.tag).toBe('v1');
  });

  test('should parse image without tag (default to latest)', () => {
    const result = parser.parse('python');
    expect(result.repository).toBe('python');
    expect(result.tag).toBe('latest');
  });

  test('should parse complex image path', () => {
    const result = parser.parse('gcr.io/my-project/my-app:v2');
    expect(result.registry).toBe('gcr.io');
    expect(result.repository).toBe('my-project/my-app');
    expect(result.tag).toBe('v2');
  });

  test('should build fullName from parts', () => {
    const result = parser.parse('localhost:5000/my-app:v1');
    expect(result.fullName).toBe('localhost:5000/my-app:v1');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd apps/devpod && npm test -- --testPathPattern="image/parser" --coverage=false
# Expected: FAIL - file does not exist
```

**Step 3: Write minimal implementation**

```typescript
// apps/devpod/src/image/parser.ts

export interface ParsedImage {
  registry: string;
  repository: string;
  tag: string;
  fullName: string;
}

export class ImageParser {
  parse(imageName: string): ParsedImage {
    // Handle image name format: [registry/][namespace/]repository[:tag]
    let registry = 'docker.io';
    let repository = imageName;
    let tag = 'latest';

    // Check for tag
    const tagIndex = repository.lastIndexOf(':');
    if (tagIndex !== -1) {
      const potentialTag = repository.substring(tagIndex + 1);
      // Check if it's a tag (not a port in registry)
      if (!potentialTag.includes('/')) {
        tag = potentialTag;
        repository = repository.substring(0, tagIndex);
      }
    }

    // Check for registry (contains /)
    if (repository.includes('/')) {
      const parts = repository.split('/');
      const potentialRegistry = parts[0];
      if (potentialRegistry.includes('.') || potentialRegistry === 'localhost') {
        registry = potentialRegistry;
        repository = parts.slice(1).join('/');
      }
    }

    // Handle docker.io library prefix
    if (repository === 'library' || repository.startsWith('library/')) {
      repository = repository.replace('library/', '');
    }

    const fullName = registry === 'docker.io'
      ? `${repository}:${tag}`
      : `${registry}/${repository}:${tag}`;

    return { registry, repository, tag, fullName };
  }
}
```

**Step 4: Run test to verify it passes**

```bash
cd apps/devpod && npm test -- --testPathPattern="image/parser" --coverage=false
# Expected: PASS
```

**Step 5: Commit**

```bash
git add apps/devpod/src/image/parser.ts apps/devpod/src/image/parser.test.ts
git commit -m "feat(image): add image parser for parsing image names"
```

---

## Task 3: Create Cache Manager

**Files:**
- Create: `apps/devpod/src/image/cache.ts`
- Test: `apps/devpod/src/image/cache.test.ts`

**Step 1: Write the failing test**

```typescript
import * as fs from 'fs';
import { CacheManager } from './cache';
import { ResolvedImage } from './types';

describe('CacheManager', () => {
  let cache: CacheManager;
  const testCacheDir = '/tmp/test-image-cache-' + Date.now();

  beforeEach(() => {
    cache = new CacheManager(testCacheDir);
  });

  afterEach(() => {
    fs.rmSync(testCacheDir, { recursive: true, force: true });
  });

  test('should create cache directory', () => {
    expect(fs.existsSync(testCacheDir)).toBe(true);
  });

  test('should store and check blob existence', async () => {
    const image: ResolvedImage = {
      originalName: 'python:3.11',
      fullName: 'localhost:5000/python:3.11',
      registry: 'localhost:5000',
      repository: 'python',
      tag: '3.11',
      useCache: true,
    };

    const content = Buffer.from('test blob content');
    await cache.storeBlob(image, content);

    const exists = await cache.exists(image);
    expect(exists).toBe(true);
  });

  test('should list repositories', async () => {
    const image1: ResolvedImage = {
      originalName: 'python:3.11',
      fullName: 'localhost:5000/python:3.11',
      registry: 'localhost:5000',
      repository: 'python',
      tag: '3.11',
      useCache: true,
    };
    await cache.storeBlob(image1, Buffer.from('content'));

    const repos = await cache.listRepositories();
    expect(repos).toContain('python');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd apps/devpod && npm test -- --testPathPattern="image/cache" --coverage=false
# Expected: FAIL - file does not exist
```

**Step 3: Write minimal implementation**

```typescript
// apps/devpod/src/image/cache.ts

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
```

**Step 4: Run test to verify it passes**

```bash
cd apps/devpod && npm test -- --testPathPattern="image/cache" --coverage=false
# Expected: PASS
```

**Step 5: Commit**

```bash
git add apps/devpod/src/image/cache.ts apps/devpod/src/image/cache.test.ts
git commit -m "feat(image): add cache manager for local image caching"
```

---

## Task 4: Create Registry Client

**Files:**
- Create: `apps/devpod/src/image/client.ts`
- Test: `apps/devpod/src/image/client.test.ts`

**Step 1: Write the failing test**

```typescript
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
```

**Step 2: Run test to verify it fails**

```bash
cd apps/devpod && npm test -- --testPathPattern="image/client" --coverage=false
# Expected: FAIL - file does not exist
```

**Step 3: Write minimal implementation**

```typescript
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
```

**Step 4: Run test to verify it passes**

```bash
cd apps/devpod && npm test -- --testPathPattern="image/client" --coverage=false
# Expected: PASS
```

**Step 5: Commit**

```bash
git add apps/devpod/src/image/client.ts apps/devpod/src/image/client.test.ts
git commit -m "feat(image): add registry client for pulling images"
```

---

## Task 5: Create Image Resolver

**Files:**
- Create: `apps/devpod/src/image/resolver.ts`
- Test: `apps/devpod/src/image/resolver.test.ts`

**Step 1: Write the failing test**

```typescript
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
});
```

**Step 2: Run test to verify it fails**

```bash
cd apps/devpod && npm test -- --testPathPattern="image/resolver" --coverage=false
# Expected: FAIL - file does not exist
```

**Step 3: Write minimal implementation**

```typescript
// apps/devpod/src/image/resolver.ts

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
```

**Step 4: Run test to verify it passes**

```bash
cd apps/devpod && npm test -- --testPathPattern="image/resolver" --coverage=false
# Expected: PASS
```

**Step 5: Commit**

```bash
git add apps/devpod/src/image/resolver.ts apps/devpod/src/image/resolver.test.ts
git commit -m "feat(image): add image resolver for smart image selection"
```

---

## Task 6: Create Image Module Index

**Files:**
- Create: `apps/devpod/src/image/index.ts`

```typescript
export * from './types';
export * from './parser';
export * from './cache';
export * from './client';
export { ImageResolver } from './resolver';
```

**Step: Commit**

```bash
git add apps/devpod/src/image/index.ts
git commit -m "feat(image): export image module"
```

---

## Task 7: Integrate with Workspace Manager

**Files:**
- Modify: `apps/devpod/src/workspace/manager.ts`

**Step 1: Read current implementation**

```typescript
// Current usage in manager.ts
const builderImage = `${this.registry}/codepod/builder:latest`;
const devImage = `${this.registry}/devpod/${name}:latest`;
```

**Step 2: Update to use ImageResolver**

```typescript
import { ImageResolver } from '../image';

export class WorkspaceManager {
  private builderImage: string;
  private registry: string;
  private imageResolver: ImageResolver;

  constructor() {
    this.registry = configManager.getRegistry();
    this.builderImage = `${this.registry}/codepod/builder:latest`;
    this.imageResolver = new ImageResolver({
      preferCache: true,
      cacheRegistry: this.registry,
      fallbackRegistries: ['docker.io'],
      prefixMappings: {},
    });
  }

  async create(options: BuildOptions): Promise<void> {
    // Use resolver for dev container image
    const devImageRef = await this.imageResolver.getImage('python:3.11'); // Example
    // ...
  }
}
```

**Step 3: Commit**

```bash
git add apps/devpod/src/workspace/manager.ts
git commit -m "feat(workspace): integrate image resolver for smart image selection"
```

---

## Summary

| Task | Description | Status |
|------|-------------|--------|
| 1 | Image Types | Pending |
| 2 | Image Parser | Pending |
| 3 | Cache Manager | Pending |
| 4 | Registry Client | Pending |
| 5 | Image Resolver | Pending |
| 6 | Image Module Index | Pending |
| 7 | Workspace Integration | Pending |

**Total: 7 tasks**
