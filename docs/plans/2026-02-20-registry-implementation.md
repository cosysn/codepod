# Registry Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement内置OCI镜像仓库，支持完整的Docker Registry v2 API和外部仓库对接。

**Architecture:** 使用 go-containerregistry 库处理 OCI 镜像规范，实现 Docker Registry V2 兼容 API。存储层使用本地文件系统，支持后续扩展到对象存储。

**Tech Stack:** TypeScript (Server), go-containerregistry, SQLite (元数据)

---

## Prerequisites

### Dependencies to add in sandbox/server/package.json

```json
{
  "dependencies": {
    "@types/sha.js": "^2.4.0",
    "sha.js": "^2.4.11"
  }
}
```

---

## Phase 1: Storage Layer and Types

### Task 1: Create Registry Types

**Files:**
- Create: `sandbox/server/src/registry/types/registry.ts`
- Create: `sandbox/server/src/registry/types/index.ts`

**Step 1: Write the failing test**

```typescript
// sandbox/server/src/registry/types/registry.test.ts
import { Image, Tag, Manifest } from './registry';

describe('Registry Types', () => {
  test('Image type should have required fields', () => {
    const image: Image = {
      name: 'python',
      tags: ['3.11', '3.10'],
      createdAt: new Date(),
      updatedAt: new Date(),
      size: 1024,
    };
    expect(image.name).toBe('python');
    expect(image.tags).toContain('3.11');
  });

  test('Tag type should have required fields', () => {
    const tag: Tag = {
      name: 'python:3.11',
      digest: 'sha256:abc123',
      createdAt: new Date(),
      size: 1024,
      architecture: 'amd64',
      os: 'linux',
      layers: 5,
    };
    expect(tag.digest).toMatch(/^sha256:/);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd sandbox/server && npm test -- --testPathPattern="registry/types" --coverage=false
# Expected: FAIL - file does not exist
```

**Step 3: Write minimal implementation**

```typescript
// sandbox/server/src/registry/types/index.ts
export * from './registry';

// sandbox/server/src/registry/types/registry.ts
export interface Image {
  name: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  size: number;
  manifest?: Manifest;
}

export interface Tag {
  name: string;
  digest: string;
  createdAt: Date;
  size: number;
  architecture: string;
  os: string;
  layers: number;
}

export interface Manifest {
  schemaVersion: number;
  mediaType: string;
  config: {
    mediaType: string;
    digest: string;
    size: number;
  };
  layers: Array<{
    mediaType: string;
    digest: string;
    size: number;
    urls?: string[];
  }>;
  annotations?: Record<string, string>;
}

export interface ExternalRegistry {
  id: string;
  name: string;
  type: 'harbor' | 'ecr' | 'dockerhub' | 'gcr' | 'acr' | 'custom';
  endpoint: string;
  auth: {
    type: 'basic' | 'bearer' | 'aws-iam' | 'gcp-iam';
    username?: string;
    password?: string;
    registryToken?: string;
  };
  insecure: boolean;
  createdAt: Date;
}
```

**Step 4: Run test to verify it passes**

```bash
cd sandbox/server && npm test -- --testPathPattern="registry/types" --coverage=false
# Expected: PASS
```

**Step 5: Commit**

```bash
git add sandbox/server/src/registry/types/
git commit -m "feat(registry): add registry types definition"
```

---

### Task 2: Create Storage Service

**Files:**
- Create: `sandbox/server/src/registry/services/storage.ts`
- Create: `sandbox/server/src/registry/services/storage.test.ts`

**Step 1: Write the failing test**

```typescript
import { StorageService } from './storage';
import * as fs from 'fs';
import * as path from 'path';

describe('StorageService', () => {
  let storage: StorageService;
  const testRoot = '/tmp/test-registry';

  beforeAll(() => {
    storage = new StorageService(testRoot);
  });

  afterAll(() => {
    // Cleanup
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  test('should initialize storage directory', () => {
    expect(fs.existsSync(path.join(testRoot, 'blobs'))).toBe(true);
    expect(fs.existsSync(path.join(testRoot, 'manifests'))).toBe(true);
  });

  test('should store and retrieve blob', async () => {
    const content = Buffer.from('test blob content');
    const digest = await storage.storeBlob('sha256', content);
    expect(digest).toMatch(/^sha256:[a-f0-9]{64}$/);

    const retrieved = await storage.getBlob(digest);
    expect(retrieved.toString()).toBe('test blob content');
  });

  test('should store and retrieve manifest', async () => {
    const manifest = { schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json' };
    const ref = 'latest';
    const digest = await storage.storeManifest('python', ref, manifest as any);
    expect(digest).toMatch(/^sha256:[a-f0-9]{64}$/);

    const retrieved = await storage.getManifest('python', 'latest');
    expect(retrieved).toEqual(manifest);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd sandbox/server && npm test -- --testPathPattern="registry/services/storage" --coverage=false
# Expected: FAIL - file does not exist
```

**Step 3: Write minimal implementation**

```typescript
// sandbox/server/src/registry/services/storage.ts
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

  private initialize(): void {
    // Create directory structure
    const dirs = [
      this.blobsDir,
      path.join(this.blobsDir, 'sha256'),
      path.join(this.blobsDir, 'sha512'),
      path.join(this.manifestsDir, 'repositories'),
      path.join(this.manifestsDir, 'tags'),
    ];
    for (const dir of dirs) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  async storeBlob(alg: string, content: Buffer): Promise<string> {
    const hash = crypto.createHash(alg.replace('-', ''));
    hash.update(content);
    const digest = `${alg}:${hash.digest('hex')}`;

    const digestPath = this.getDigestPath(digest);
    fs.mkdirSync(path.dirname(digestPath), { recursive: true });
    fs.writeFileSync(digestPath, content);

    return digest;
  }

  async getBlob(digest: string): Promise<Buffer> {
    const digestPath = this.getDigestPath(digest);
    if (!fs.existsSync(digestPath)) {
      throw new Error(`Blob not found: ${digest}`);
    }
    return fs.readFileSync(digestPath);
  }

  async blobExists(digest: string): Promise<boolean> {
    const digestPath = this.getDigestPath(digest);
    return fs.existsSync(digestPath);
  }

  async storeManifest(repository: string, ref: string, manifest: any): Promise<string> {
    const content = Buffer.from(JSON.stringify(manifest));
    const digest = await this.storeBlob('sha256', content);

    // Store by reference (tag)
    const refPath = path.join(this.manifestsDir, 'repositories', repository, 'tags', ref);
    fs.mkdirSync(path.dirname(refPath), { recursive: true });
    fs.writeFileSync(refPath, digest);

    return digest;
  }

  async getManifest(repository: string, ref: string): Promise<any> {
    const refPath = path.join(this.manifestsDir, 'repositories', repository, 'tags', ref);
    if (!fs.existsSync(refPath)) {
      throw new Error(`Manifest not found: ${repository}:${ref}`);
    }

    const digest = fs.readFileSync(refPath, 'utf-8').trim();
    const blob = await this.getBlob(digest);
    return JSON.parse(blob.toString());
  }

  async deleteManifest(repository: string, ref: string): Promise<void> {
    const refPath = path.join(this.manifestsDir, 'repositories', repository, 'tags', ref);
    if (fs.existsSync(refPath)) {
      fs.rmSync(refPath);
    }
  }

  async listRepositories(): Promise<string[]> {
    const reposDir = path.join(this.manifestsDir, 'repositories');
    if (!fs.existsSync(reposDir)) {
      return [];
    }
    return fs.readdirSync(reposDir);
  }

  async listTags(repository: string): Promise<string[]> {
    const tagsDir = path.join(this.manifestsDir, 'repositories', repository, 'tags');
    if (!fs.existsSync(tagsDir)) {
      return [];
    }
    return fs.readdirSync(tagsDir);
  }

  private getDigestPath(digest: string): string {
    const [, hash] = digest.split(':');
    return path.join(this.blobsDir, 'sha256', hash.substring(0, 2), hash.substring(2));
  }
}
```

**Step 4: Run test to verify it passes**

```bash
cd sandbox/server && npm test -- --testPathPattern="registry/services/storage" --coverage=false
# Expected: PASS
```

**Step 5: Commit**

```bash
git add sandbox/server/src/registry/services/storage.ts sandbox/server/src/registry/services/storage.test.ts
git commit -m "feat(registry): add storage service for blobs and manifests"
```

---

## Phase 2: Registry Service Core

### Task 3: Create Registry Service

**Files:**
- Create: `sandbox/server/src/registry/services/registry.ts`
- Create: `sandbox/server/src/registry/services/registry.test.ts`

**Step 1: Write the failing test**

```typescript
import { RegistryService } from './registry';

describe('RegistryService', () => {
  let registry: RegistryService;

  beforeAll(() => {
    registry = new RegistryService('/tmp/test-registry');
  });

  afterAll(() => {
    // Cleanup handled by storage tests
  });

  test('should push and pull image', async () => {
    const manifest = {
      schemaVersion: 2,
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      config: {
        mediaType: 'application/vnd.oci.image.config.v1+json',
        digest: 'sha256:config123',
        size: 100,
      },
      layers: [
        {
          mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
          digest: 'sha256:layer123',
          size: 1000,
        },
      ],
    };

    // Push
    const digest = await registry.pushManifest('python', '3.11', manifest as any);
    expect(digest).toMatch(/^sha256:/);

    // Pull
    const pulled = await registry.pullManifest('python', '3.11');
    expect(pulled).toEqual(manifest);
  });

  test('should list repositories', async () => {
    const repos = await registry.listRepositories();
    expect(repos).toContain('python');
  });

  test('should list tags', async () => {
    const tags = await registry.listTags('python');
    expect(tags).toContain('3.11');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd sandbox/server && npm test -- --testPathPattern="registry/services/registry" --coverage=false
# Expected: FAIL - file does not exist
```

**Step 3: Write minimal implementation**

```typescript
// sandbox/server/src/registry/services/registry.ts
import { StorageService } from './storage';
import { Manifest } from '../types/registry';

export class RegistryService {
  private storage: StorageService;

  constructor(storageRoot?: string) {
    this.storage = new StorageService(storageRoot);
  }

  async pushManifest(repository: string, ref: string, manifest: Manifest): Promise<string> {
    return this.storage.storeManifest(repository, ref, manifest);
  }

  async pullManifest(repository: string, ref: string): Promise<Manifest> {
    return this.storage.getManifest(repository, ref);
  }

  async deleteManifest(repository: string, ref: string): Promise<void> {
    return this.storage.deleteManifest(repository, ref);
  }

  async listRepositories(): Promise<string[]> {
    return this.storage.listRepositories();
  }

  async listTags(repository: string): Promise<string[]> {
    return this.storage.listTags(repository);
  }

  async blobExists(digest: string): Promise<boolean> {
    return this.storage.blobExists(digest);
  }

  async getBlob(digest: string): Promise<Buffer> {
    return this.storage.getBlob(digest);
  }

  async storeBlob(content: Buffer): Promise<string> {
    return this.storage.storeBlob('sha256', content);
  }

  async checkHealth(): Promise<{ status: string }> {
    return { status: 'healthy' };
  }
}
```

**Step 4: Run test to verify it passes**

```bash
cd sandbox/server && npm test -- --testPathPattern="registry/services/registry" --coverage=false
# Expected: PASS
```

**Step 5: Commit**

```bash
git add sandbox/server/src/registry/services/registry.ts sandbox/server/src/registry/services/registry.test.ts
git commit -m "feat(registry): add registry core service"
```

---

## Phase 3: API Routes

### Task 4: Create Images API Routes

**Files:**
- Create: `sandbox/server/src/registry/routes/images.ts`
- Create: `sandbox/server/src/registry/routes/images.test.ts`

**Step 1: Write the failing test**

```typescript
import express from 'express';
import request from 'supertest';
import { imagesRouter } from './images';

describe('Images API', () => {
  let app: express.Express;

  beforeAll(() => {
    app = express();
    app.use('/api/v1/registry/images', imagesRouter);
  });

  test('GET /api/v1/registry/images should list images', async () => {
    const response = await request(app).get('/api/v1/registry/images');
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd sandbox/server && npm test -- --testPathPattern="registry/routes/images" --coverage=false
# Expected: FAIL - file does not exist
```

**Step 3: Write minimal implementation**

```typescript
// sandbox/server/src/registry/routes/images.ts
import { Router, Request, Response } from 'express';
import { RegistryService } from '../services/registry';

const router = Router();
const registry = new RegistryService();

// GET /api/v1/registry/images - List all repositories
router.get('/', async (req: Request, res: Response) => {
  try {
    const repos = await registry.listRepositories();
    res.json({ images: repos });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/v1/registry/images/:name - Get image details
router.get('/:name', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const tags = await registry.listTags(name);
    res.json({ name, tags });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

// DELETE /api/v1/registry/images/:name - Delete image
router.delete('/:name', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    // TODO: Implement delete all tags for image
    res.json({ message: `Image ${name} deleted` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export { router as imagesRouter };
```

**Step 4: Run test to verify it passes**

```bash
cd sandbox/server && npm test -- --testPathPattern="registry/routes/images" --coverage=false
# Expected: PASS
```

**Step 5: Commit**

```bash
git add sandbox/server/src/registry/routes/images.ts sandbox/server/src/registry/routes/images.test.ts
git commit -m "feat(registry): add images API routes"
```

---

### Task 5: Create Tags API Routes

**Files:**
- Create: `sandbox/server/src/registry/routes/tags.ts`
- Create: `sandbox/server/src/registry/routes/tags.test.ts`

**Step 1: Write the failing test**

```typescript
import express from 'express';
import request from 'supertest';
import { tagsRouter } from './tags';

describe('Tags API', () => {
  let app: express.Express;

  beforeAll(() => {
    app = express();
    app.use('/api/v1/registry/tags', tagsRouter);
  });

  test('GET /api/v1/registry/tags should list tags', async () => {
    const response = await request(app).get('/api/v1/registry/tags');
    expect(response.status).toBe(200);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd sandbox/server && npm test -- --testPathPattern="registry/routes/tags" --coverage=false
# Expected: FAIL - file does not exist
```

**Step 3: Write minimal implementation**

```typescript
// sandbox/server/src/registry/routes/tags.ts
import { Router, Request, Response } from 'express';
import { RegistryService } from '../services/registry';

const router = Router();
const registry = new RegistryService();

// GET /api/v1/registry/tags - List all tags with image names
router.get('/', async (req: Request, res: Response) => {
  try {
    const repos = await registry.listRepositories();
    const tags: Array<{ name: string; tag: string }> = [];
    for (const repo of repos) {
      const repoTags = await registry.listTags(repo);
      for (const tag of repoTags) {
        tags.push({ name: `${repo}:${tag}`, tag });
      }
    }
    res.json({ tags });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/v1/registry/tags/:name - Get tag details (manifest)
router.get('/:name', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    // Parse name as repo:tag
    const [repo, tag] = name.split(':');
    if (!tag) {
      return res.status(400).json({ error: 'Invalid tag name, use format: repo:tag' });
    }

    const manifest = await registry.pullManifest(repo, tag);
    res.json({ name, manifest });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

// DELETE /api/v1/registry/tags/:name - Delete tag
router.delete('/:name', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const [repo, tag] = name.split(':');
    if (!tag) {
      return res.status(400).json({ error: 'Invalid tag name' });
    }

    await registry.deleteManifest(repo, tag);
    res.json({ message: `Tag ${name} deleted` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export { router as tagsRouter };
```

**Step 4: Run test to verify it passes**

```bash
cd sandbox/server && npm test -- --testPathPattern="registry/routes/tags" --coverage=false
# Expected: PASS
```

**Step 5: Commit**

```bash
git add sandbox/server/src/registry/routes/tags.ts sandbox/server/src/registry/routes/tags.test.ts
git commit -m "feat(registry): add tags API routes"
```

---

### Task 6: Create Docker Registry V2 API Routes

**Files:**
- Create: `sandbox/server/src/registry/routes/v2.ts`
- Create: `sandbox/server/src/registry/routes/v2.test.ts`

**Step 1: Write the failing test**

```typescript
import express from 'express';
import request from 'supertest';
import { v2Router } from './v2';

describe('Docker Registry V2 API', () => {
  let app: express.Express;

  beforeAll(() => {
    app = express();
    app.use('/v2', v2Router);
  });

  test('GET /v2/ should return API version', async () => {
    const response = await request(app).get('/v2/');
    expect(response.status).toBe(200);
    expect(response.body.version).toBeDefined();
  });

  test('GET /v2/_catalog should return repositories', async () => {
    const response = await request(app).get('/v2/_catalog');
    expect(response.status).toBe(200);
    expect(response.body.repositories).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd sandbox/server && npm test -- --testPathPattern="registry/routes/v2" --coverage=false
# Expected: FAIL - file does not exist
```

**Step 3: Write minimal implementation**

```typescript
// sandbox/server/src/registry/routes/v2.ts
import { Router, Request, Response } from 'express';
import { RegistryService } from '../services/registry';

const router = Router();
const registry = new RegistryService();

// GET /v2/ - API version check
router.get('/', async (req: Request, res: Response) => {
  res.json({
    version: '2.0',
    name: 'codepod-registry',
  });
});

// GET /v2/_catalog - List repositories
router.get('/_catalog', async (req: Request, res: Response) => {
  try {
    const repos = await registry.listRepositories();
    res.json({ repositories: repos });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /v2/<name>/tags/list - List tags for image
router.get('/:name/tags/list', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const tags = await registry.listTags(name);
    res.json({ name, tags });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

// GET /v2/<name>/manifests/<ref> - Get manifest
router.get('/:name/manifests/:ref', async (req: Request, res: Response) => {
  try {
    const { name, ref } = req.params;
    const manifest = await registry.pullManifest(name, ref);
    res.set('Content-Type', 'application/vnd.oci.image.manifest.v1+json');
    res.json(manifest);
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

// HEAD /v2/<name>/blobs/<digest> - Check blob exists
router.head('/:name/blobs/:digest', async (req: Request, res: Response) => {
  try {
    const { digest } = req.params;
    const exists = await registry.blobExists(digest);
    if (exists) {
      res.status(200).end();
    } else {
      res.status(404).end();
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /v2/<name>/blobs/<digest> - Get blob
router.get('/:name/blobs/:digest', async (req: Request, res: Response) => {
  try {
    const { digest } = req.params;
    const blob = await registry.getBlob(digest);
    res.set('Content-Type', 'application/octet-stream');
    res.send(blob);
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

// POST /v2/<name>/blobs/uploads/ - Initiate blob upload
router.post('/:name/blobs/uploads/', async (req: Request, res: Response) => {
  const { name } = req.params;
  const uploadId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
  res.status(202).set('Location', `/v2/${name}/blobs/uploads/${uploadId}`)
    .json({ uploadUrl: `/v2/${name}/blobs/uploads/${uploadId}` });
});

// PUT /v2/<name>/blobs/uploads/<id> - Upload blob
router.put('/:name/blobs/uploads/:id', async (req: Request, res: Response) => {
  try {
    const { name, id } = req.params;
    const content = req.body;
    const digest = await registry.storeBlob(content);
    res.status(201).set('Docker-Content-Digest', digest).json({ digest });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /v2/<name>/manifests/<ref> - Delete manifest
router.delete('/:name/manifests/:ref', async (req: Request, res: Response) => {
  try {
    const { name, ref } = req.params;
    await registry.deleteManifest(name, ref);
    res.status(202).json({ message: 'Manifest deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export { router as v2Router };
```

**Step 4: Run test to verify it passes**

```bash
cd sandbox/server && npm test -- --testPathPattern="registry/routes/v2" --coverage=false
# Expected: PASS
```

**Step 5: Commit**

```bash
git add sandbox/server/src/registry/routes/v2.ts sandbox/server/src/registry/routes/v2.test.ts
git commit -m "feat(registry): add Docker Registry V2 compatible API routes"
```

---

### Task 7: Register Registry Routes in Server

**Files:**
- Modify: `sandbox/server/src/app.ts` (or main server file)

**Step 1: Write the failing test**

```typescript
// sandbox/server/src/registry/routes/index.test.ts
describe('Registry Routes Index', () => {
  test('should export all routes', () => {
    const { imagesRouter, tagsRouter, v2Router } = require('./index');
    expect(imagesRouter).toBeDefined();
    expect(tagsRouter).toBeDefined();
    expect(v2Router).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd sandbox/server && npm test -- --testPathPattern="registry/routes/index" --coverage=false
# Expected: FAIL - file does not exist
```

**Step 3: Write minimal implementation**

```typescript
// sandbox/server/src/registry/routes/index.ts
export { imagesRouter } from './images';
export { tagsRouter } from './tags';
export { v2Router } from './v2';
```

**Step 4: Run test to verify it passes**

```bash
cd sandbox/server && npm test -- --testPathPattern="registry/routes/index" --coverage=false
# Expected: PASS
```

**Step 5: Commit**

```bash
git add sandbox/server/src/registry/routes/index.ts
git commit -m "feat(registry): export all registry routes"
```

**Step 6: Register routes in main app**

```typescript
// In sandbox/server/src/app.ts or equivalent
import { imagesRouter, tagsRouter, v2Router } from './registry/routes';

// Mount registry routes
app.use('/api/v1/registry/images', imagesRouter);
app.use('/api/v1/registry/tags', tagsRouter);
app.use('/v2', v2Router);
```

Run test to verify integration, then commit.

---

## Phase 4: External Registry Support (Phase 2)

### Task 8: Create External Registry Service

**Files:**
- Create: `sandbox/server/src/registry/services/external.ts`
- Create: `sandbox/server/src/registry/services/external.test.ts`

**Step 1: Write the failing test**

```typescript
import { ExternalRegistryService } from './external';

describe('ExternalRegistryService', () => {
  let service: ExternalRegistryService;

  beforeAll(() => {
    service = new ExternalRegistryService();
  });

  test('should create harbor client config', () => {
    const config = service.createHarborConfig('harbor.example.com', 'admin', 'password');
    expect(config.type).toBe('harbor');
    expect(config.endpoint).toBe('https://harbor.example.com');
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Write minimal implementation**

```typescript
// sandbox/server/src/registry/services/external.ts
import { ExternalRegistry } from '../types/registry';

export class ExternalRegistryService {
  private registries: Map<string, ExternalRegistry> = new Map();

  createHarborConfig(endpoint: string, username: string, password: string): ExternalRegistry {
    return {
      id: `harbor-${Date.now()}`,
      name: `Harbor (${endpoint})`,
      type: 'harbor',
      endpoint: `https://${endpoint}`,
      auth: {
        type: 'basic',
        username,
        password,
      },
      insecure: false,
      createdAt: new Date(),
    };
  }

  async pushToExternal(registry: ExternalRegistry, image: string, tag: string): Promise<void> {
    // TODO: Implement using go-containerregistry via SDK or direct HTTP
    console.log(`Pushing ${image}:${tag} to ${registry.endpoint}`);
  }

  async pullFromExternal(registry: ExternalRegistry, image: string, tag: string): Promise<void> {
    // TODO: Implement
    console.log(`Pulling ${image}:${tag} from ${registry.endpoint}`);
  }

  async testConnection(registry: ExternalRegistry): Promise<boolean> {
    // TODO: Implement connection test
    return true;
  }
}
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git add sandbox/server/src/registry/services/external.ts sandbox/server/src/registry/services/external.test.ts
git commit -m "feat(registry): add external registry service skeleton"
```

---

## Phase 5: Integration Tests

### Task 9: End-to-End Integration Test

**Files:**
- Create: `sandbox/server/src/registry/e2e.test.ts`

**Step 1: Write integration test**

```typescript
import express from 'express';
import request from 'supertest';
import { imagesRouter, tagsRouter, v2Router } from './routes';
import { RegistryService } from './services/registry';
import { StorageService } from './services/storage';

describe('Registry E2E', () => {
  let app: express.Express;
  let registry: RegistryService;

  beforeAll(() => {
    const storage = new StorageService('/tmp/e2e-registry');
    registry = new RegistryService('/tmp/e2e-registry');
    app = express();
    app.use(express.json());
    app.use('/api/v1/registry/images', imagesRouter);
    app.use('/api/v1/registry/tags', tagsRouter);
    app.use('/v2', v2Router);
  });

  test('full push/pull workflow', async () => {
    const manifest = {
      schemaVersion: 2,
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      config: {
        mediaType: 'application/vnd.oci.image.config.v1+json',
        digest: 'sha256:config123',
        size: 100,
      },
      layers: [],
    };

    // Push via V2 API
    const pushRes = await request(app)
      .put('/v2/test-image/manifests/latest')
      .send(manifest);
    expect(pushRes.status).toBe(201);

    // Pull via V2 API
    const pullRes = await request(app)
      .get('/v2/test-image/manifests/latest');
    expect(pullRes.status).toBe(200);
    expect(pullRes.body).toEqual(manifest);

    // List via catalog
    const catalogRes = await request(app).get('/v2/_catalog');
    expect(catalogRes.status).toBe(200);
    expect(catalogRes.body.repositories).toContain('test-image');
  });
});
```

**Step 2: Run test**

```bash
cd sandbox/server && npm test -- --testPathPattern="registry/e2e" --coverage=false
```

**Step 3: Fix any issues**

**Step 4: Commit**

```bash
git add sandbox/server/src/registry/e2e.test.ts
git commit -m "test(registry): add e2e integration tests"
```

---

## Summary

| Task | Description | Status |
|------|-------------|--------|
| 1 | Registry Types | Pending |
| 2 | Storage Service | Pending |
| 3 | Registry Service | Pending |
| 4 | Images API Routes | Pending |
| 5 | Tags API Routes | Pending |
| 6 | Docker V2 API Routes | Pending |
| 7 | Register Routes | Pending |
| 8 | External Registry Service | Pending |
| 9 | E2E Integration Tests | Pending |

**Total: 9 tasks**
