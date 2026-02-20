# DevPod Image Resolver Design

## 概述

为 DevPod 添加智能镜像选择器，支持从多个镜像源自动解析、拉取和缓存容器镜像。

## 目标

1. **智能解析** - 自动识别镜像来源（内置仓库、Docker Hub、外部仓库）
2. **缓存优先** - 优先使用内置仓库缓存
3. **透明使用** - 用户只需指定镜像名，系统自动处理
4. **自动回退** - 本地没有时自动从外部仓库拉取

## 架构设计

```
┌─────────────────────────────────────────────────────────────────┐
│                     Image Resolver                              │
│  ┌──────────────┐  ┌──────────────────┐  ┌───────────────┐   │
│  │Image Parser  │→ │Registry Selector │→ │Cache Manager │   │
│  │(解析镜像名)   │  │(选择最优仓库)    │  │(缓存管理)     │   │
│  └──────────────┘  └──────────────────┘  └───────────────┘   │
└─────────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────────┐  ┌───────────────┐  ┌─────────────────┐
│ 内置 Registry    │  │ Docker Hub    │  │ 外部 Registry   │
│ (优先缓存)       │  │ (官方镜像)     │  │ (ECR/GCR...)   │
└─────────────────┘  └───────────────┘  └─────────────────┘
```

## 镜像解析规则

| 输入格式 | 来源 | 缓存优先级 | 示例 |
|----------|------|------------|------|
| `python:3.11` | Docker Hub | 无缓存 | 自动拉取 |
| `localhost:5000/my-app:v1` | 内置 Registry | 高 | 优先使用 |
| `my-registry.com/app:v1` | 外部 Registry | 无缓存 | 透明代理 |
| `my-app:latest` (配置前缀) | 内置 Registry | 高 | 带前缀映射 |

## 文件结构

```
apps/devpod/src/
├── image/
│   ├── types.ts           # 类型定义
│   ├── parser.ts          # 镜像名解析
│   ├── resolver.ts        # 镜像解析器
│   ├── cache.ts           # 缓存管理器
│   └── index.ts           # 导出
└── workspace/
    └── manager.ts         # 更新使用 ImageResolver
```

## 类型定义

```typescript
// apps/devpod/src/image/types.ts

export interface ResolvedImage {
  originalName: string;    // 原始输入
  fullName: string;       // 完整名称 (registry/repo:tag)
  registry: string;        // 来源仓库地址
  repository: string;      // 仓库路径
  tag: string;             // 标签
  digest?: string;         // 摘要（拉取后）
  useCache: boolean;      // 是否使用内置缓存
}

export interface RegistryConfig {
  name: string;           // 仓库名称
  endpoint: string;        // 仓库地址
  insecure: boolean;       // 允许 HTTP
  priority: number;        // 优先级（越小越高）
}

export interface ImageResolverConfig {
  preferCache: boolean;   // 优先使用缓存
  cacheRegistry: string;   // 缓存仓库地址
  fallbackRegistries: string[]; // 回退仓库列表
  prefixMappings: Record<string, string>; // 镜像前缀映射
}
```

## 镜像解析器

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
    this.cache = new CacheManager(this.config.cacheRegistry);
    this.client = new RegistryClient();
  }

  /**
   * 解析镜像名
   */
  resolve(imageName: string): ResolvedImage {
    const parsed = this.parser.parse(imageName);

    // 检查前缀映射
    if (this.config.prefixMappings[parsed.repository]) {
      const mapped = this.parser.parse(
        `${this.config.prefixMappings[parsed.repository]}:${parsed.tag}`
      );
      return {
        ...mapped,
        originalName: imageName,
        registry: this.config.cacheRegistry,
        useCache: true,
      };
    }

    // 检查是否是内置仓库镜像
    if (parsed.registry === 'localhost:5000' || parsed.registry === this.config.cacheRegistry) {
      return {
        ...parsed,
        originalName: imageName,
        useCache: true,
      };
    }

    // Docker Hub 官方镜像
    if (!parsed.registry || parsed.registry === 'docker.io') {
      return {
        ...this.parser.parse(`docker.io/${parsed.repository}:${parsed.tag}`),
        originalName: imageName,
        registry: 'docker.io',
        useCache: this.config.preferCache,
      };
    }

    // 外部仓库
    return {
      ...parsed,
      originalName: imageName,
      registry: parsed.registry,
      useCache: false,
    };
  }

  /**
   * 获取镜像（智能拉取）
   */
  async getImage(imageName: string): Promise<ResolvedImage> {
    const image = this.resolve(imageName);

    // 如果使用缓存，先检查缓存
    if (image.useCache) {
      const exists = await this.cache.exists(image);
      if (exists) {
        return image;
      }

      // 尝试从外部拉取到缓存
      if (image.registry !== this.config.cacheRegistry) {
        await this.pullToCache(image);
      }
    }

    return image;
  }

  /**
   * 拉取到缓存
   */
  async pullToCache(image: ResolvedImage): Promise<void> {
    const cacheImage = {
      ...image,
      registry: this.config.cacheRegistry,
    };

    await this.client.pull(image, async (blob) => {
      await this.cache.storeBlob(cacheImage, blob);
    });

    await this.cache.storeManifest(cacheImage, image.tag);
  }

  /**
   * 列出缓存的镜像
   */
  async listCachedImages(): Promise<string[]> {
    return this.cache.listRepositories();
  }
}
```

## Registry 客户端

```typescript
// apps/devpod/src/image/client.ts

import { ResolvedImage } from './types';

export class RegistryClient {
  private tokenCache: Map<string, string> = new Map();

  /**
   * 获取认证 Token
   */
  private async getToken(registry: string, repository: string): Promise<string> {
    const cacheKey = `${registry}/${repository}`;
    if (this.tokenCache.has(cacheKey)) {
      return this.tokenCache.get(cacheKey)!;
    }

    // Docker Registry V2 Token 流程
    const token = await this.fetchToken(registry, repository);
    this.tokenCache.set(cacheKey, token);
    return token;
  }

  /**
   * 拉取镜像
   */
  async pull(image: ResolvedImage, onBlob: (blob: Buffer) => Promise<void>): Promise<void> {
    const token = await this.getToken(image.registry, image.repository);

    // 1. 获取 Manifest
    const manifest = await this.fetchManifest(image, token);

    // 2. 下载 Layers
    for (const layer of manifest.layers) {
      const blob = await this.fetchBlob(image.registry, layer.digest, token);
      await onBlob(blob);
    }
  }

  /**
   * 检查镜像是否存在
   */
  async exists(image: ResolvedImage): Promise<boolean> {
    try {
      await this.fetchManifest(image, '');
      return true;
    } catch {
      return false;
    }
  }
}
```

## 缓存管理器

```typescript
// apps/devpod/src/image/cache.ts

import * as fs from 'fs';
import * as path from 'path';

export class CacheManager {
  private cacheDir: string;

  constructor(registry: string) {
    this.cacheDir = path.join(process.env.HOME || '/root', '.devpod', 'cache', registry);
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  async exists(image: ResolvedImage): Promise<boolean> {
    const manifestPath = this.getManifestPath(image);
    return fs.existsSync(manifestPath);
  }

  async storeBlob(image: ResolvedImage, blob: Buffer): Promise<void> {
    const blobPath = this.getBlobPath(image);
    fs.mkdirSync(path.dirname(blobPath), { recursive: true });
    fs.writeFileSync(blobPath, blob);
  }

  async storeManifest(image: ResolvedImage, tag: string): Promise<void> {
    const manifestPath = this.getManifestPath(image, tag);
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify({}));
  }

  async listRepositories(): Promise<string[]> {
    const reposDir = path.join(this.cacheDir, 'manifests', 'repositories');
    if (!fs.existsSync(reposDir)) {
      return [];
    }
    return fs.readdirSync(reposDir);
  }

  private getManifestPath(image: ResolvedImage, tag?: string): string {
    const ref = tag || image.tag;
    return path.join(this.cacheDir, 'manifests', 'repositories', image.repository, 'tags', ref);
  }

  private getBlobPath(image: ResolvedImage): string {
    const digest = image.digest || '';
    const hash = digest.replace(/^[a-f0-9]+:/, '');
    return path.join(this.cacheDir, 'blobs', 'sha256', hash.substring(0, 2), hash.substring(2));
  }
}
```

## 配置集成

```typescript
// apps/devpod/src/config.ts

export interface DevPodConfig {
  endpoint: string;
  registry: string;
  imageResolver?: {
    preferCache?: boolean;
    fallbackRegistries?: string[];
    prefixMappings?: Record<string, string>;
  };
}
```

## 使用示例

```typescript
// 在 workspace/manager.ts 中使用

import { ImageResolver } from './image';

const resolver = new ImageResolver({
  preferCache: true,
  fallbackRegistries: ['docker.io'],
  prefixMappings: {
    'my-app': 'localhost:5000/my-org/my-app',
  },
});

// 用户指定 python:3.11
const image1 = await resolver.getImage('python:3.11');
// → 使用 Docker Hub

// 用户指定 my-app:v1 (有前缀映射)
const image2 = await resolver.getImage('my-app:v1');
// → 使用 localhost:5000/my-org/my-app:v1 (缓存)

// 用户指定 custom-registry.com/app:v1
const image3 = await resolver.getImage('custom-registry.com/app:v1');
// → 从外部仓库拉取
```

## API 端点

### GET /api/v1/registry/cache/images

列出缓存的镜像：

```bash
curl http://localhost:8080/api/v1/registry/cache/images
# Response: { "images": ["my-app", "python", "node"] }
```

### POST /api/v1/registry/cache/pull

拉取镜像到缓存：

```bash
curl -X POST http://localhost:8080/api/v1/registry/cache/pull \
  -H "Content-Type: application/json" \
  -d '{"image": "python:3.11"}'
# Response: { "status": "pulled", "cachedAs": "localhost:5000/python:3.11" }
```

## 实现优先级

### Phase 1: 核心功能
- [ ] Image Parser (镜像名解析)
- [ ] Image Resolver (智能选择)
- [ ] Cache Manager (本地缓存)
- [ ] Registry Client (基础拉取)

### Phase 2: 完整功能
- [ ] Docker Hub 集成
- [ ] 外部仓库配置
- [ ] 镜像标签管理
- [ ] 缓存清理

### Phase 3: 高级功能
- [ ] 镜像预热
- [ ] 缓存同步
- [ ] 多仓库镜像复制
