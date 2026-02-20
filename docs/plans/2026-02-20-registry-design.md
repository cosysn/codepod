# Registry Design - 内置 OCI 镜像仓库

## 概述

在 CodePod Server 中集成内置 OCI 镜像仓库，支持：
- 完整的 Docker Registry v2 API
- 对接外部镜像仓库（Harbor、ECR、Docker Hub 等）
- 镜像和标签的 CRUD 操作
- 读写模式（支持 push/pull）

## 架构设计

```
┌─────────────────────────────────────────────────────────────────┐
│                      CodePod Server                             │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    Registry Controller                     │  │
│  │  ┌─────────────┐  ┌─────────────────┐  ┌──────────────┐  │  │
│  │  │Images API   │  │Tags API         │  │External API │  │  │
│  │  └─────────────┘  └─────────────────┘  └──────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│           │                    │                    │           │
│           ▼                    ▼                    ▼           │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                   Registry Service                        │  │
│  │                  (go-containerregistry)                    │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐  │  │
│  │  │Push/Pull   │  │Manifest Mgmt │  │Blob Storage     │  │  │
│  │  └─────────────┘  └──────────────┘  └─────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                  │
│                              ▼                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                   Storage Layer                           │  │
│  │  ┌────────────────┐  ┌─────────────────────────────────┐ │  │
│  │  │Local FS Store │  │ External Registry Client         │ │  │
│  │  │(blobs/manifest│  │ (Harbor/ECR/Docker Hub Client)  │ │  │
│  │  │ catalog)      │  │                                 │ │  │
│  │  └────────────────┘  └─────────────────────────────────┘ │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 目录结构

```
sandbox/server/src/
├── registry/
│   ├── routes/
│   │   ├── images.ts       # 镜像管理 API
│   │   ├── tags.ts         # 标签管理 API
│   │   └── external.ts      # 外部仓库配置 API
│   ├── services/
│   │   ├── registry.ts      # 核心 Registry 服务
│   │   ├── storage.ts       # 存储层（本地 + 外部）
│   │   └── auth.ts          # 认证服务
│   ├── types/
│   │   └── registry.ts     # 类型定义
│   └── utils/
│       └── manifest.ts      # Manifest 处理工具
```

## API 设计

### 镜像管理

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/registry/images` | GET | 列出所有镜像 |
| `/api/v1/registry/images/:name` | GET | 获取镜像详情 |
| `/api/v1/registry/images/:name` | DELETE | 删除镜像及其所有标签 |

### 标签管理

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/registry/tags` | GET | 列出所有标签（带镜像名） |
| `/api/v1/registry/tags/:name` | GET | 获取标签详情（包含 Manifest） |
| `/api/v1/registry/tags/:name` | DELETE | 删除指定标签 |

### 外部仓库配置

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/registry/external` | GET | 列出外部仓库配置 |
| `/api/v1/registry/external` | POST | 添加外部仓库配置 |
| `/api/v1/registry/external/:id` | GET | 获取外部仓库详情 |
| `/api/v1/registry/external/:id` | DELETE | 删除外部仓库配置 |

### Docker Registry V2 兼容 API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v2/` | GET | API 版本检查 |
| `/v2/_catalog` | GET | 列出所有镜像 |
| `/v2/<name>/tags/list` | GET | 列出镜像的标签 |
| `/v2/<name>/manifests/<ref>` | GET | 获取 Manifest |
| `/v2/<name>/manifests/<ref>` | PUT | 上传 Manifest |
| `/v2/<name>/manifests/<ref>` | DELETE | 删除 Manifest |
| `/v2/<name>/blobs/<digest>` | GET | 下载 Blob |
| `/v2/<name>/blobs/<digest>` | HEAD | 检查 Blob 存在 |
| `/v2/<name>/blobs/uploads/<uuid>` | POST | 初始化上传 |
| `/v2/<name>/blobs/uploads/<uuid>` | PUT | 上传 Blob 数据 |
| `/v2/<name>/blobs/uploads/<uuid>` | DELETE | 取消上传 |

## 数据模型

```typescript
// 镜像信息
interface Image {
  name: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  size: number; // 总大小
  manifest?: Manifest;
}

// 标签信息
interface Tag {
  name: string; // full name: repo/image:tag
  digest: string;
  createdAt: Date;
  size: number;
  architecture: string;
  os: string;
  layers: number;
}

// 外部仓库配置
interface ExternalRegistry {
  id: string;
  name: string;
  type: 'harbor' | 'ecr' | 'dockerhub' | 'gcr' | 'acr' | 'custom';
  endpoint: string;
  auth: {
    type: 'basic' | 'bearer' | 'aws-iam' | 'gcp-iam';
    username?: string;
    password?: string; // 加密存储
    registryToken?: string;
  };
  insecure: boolean; // 允许 HTTP（非 HTTPS）
  createdAt: Date;
}

// Manifest (OCI Image Index / Manifest List)
interface Manifest {
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
```

## 存储结构

```
data/registry/
├── blobs/                    # Blob 存储
│   ├── sha256/
│   │   ├── aa/
│   │   │   └── bbcc...       # sha256: aabbcc...
│   │   └── ...
│   └── sha512/
│       └── ...
├── manifests/
│   └── repositories/         # 仓库索引
│       ├── python/
│       │   └── tags/
│       │       ├── latest
│       │       └── 3.11
│       └── nodejs/
│           └── tags/
│               └── 20
└── catalog                   # 全局目录索引
    └── catalog.json
```

## 外部仓库对接

### 认证类型支持

| 类型 | 认证方式 |
|------|----------|
| Harbor | Basic Auth (username/password) |
| Docker Hub | Docker Token 或 Basic Auth |
| AWS ECR | AWS IAM Role / aws-cli credential |
| GCP GCR | gcloud SDK credential |
| Azure ACR | Azure AD Token |
| Custom Registry | Basic Auth 或 Bearer Token |

### 外部仓库操作

```typescript
// 从外部仓库拉取镜像到本地缓存
async pullFromExternal(registryId: string, image: string, tag: string): Promise<void> {
  // 1. 从外部仓库认证获取 token
  // 2. 下载 Manifest
  // 3. 下载所有 Layers
  // 4. 存储到本地 Registry
}

// 推送镜像到外部仓库
async pushToExternal(image: string, tag: string, registryId: string): Promise<void> {
  // 1. 从本地 Registry 读取 Manifest
  // 2. 上传所有 Layers 到外部仓库
  // 3. 上传 Manifest
}
```

## Docker Registry V2 协议支持

### 认证流程

```typescript
// 支持 Bearer Token 认证
// 1. Client 访问 /v2/
// 2. Server 返回 401 + WWW-Authenticate header
// 3. Client 获取 token (向 /auth 端点请求)
// 4. Client 使用 token 访问 API
```

### Blob 上传流程

```
┌──────────┐                              ┌──────────┐
│  Client  │                              │  Server  │
└────┬─────┘                              └────┬─────┘
     │                                           │
     │ POST /v2/<name>/blobs/uploads/            │
     │───────────────────────────────────────────>
     │                                           │
     │          202 Accepted + Location           │
     │<───────────────────────────────────────────
     │                                           │
     │ PATCH /v2/<name>/blobs/uploads/<uuid>     │
     │ (upload blob data)                         │
     │───────────────────────────────────────────>
     │                                           │
     │          204 No Content                   │
     │<───────────────────────────────────────────
     │                                           │
     │ PUT /v2/<name>/blobs/uploads/<uuid>      │
     │ ?digest=<sha256:xxx>                      │
     │───────────────────────────────────────────>
     │                                           │
     │          201 Created                      │
     │<───────────────────────────────────────────
```

## 配置项

```yaml
# sandbox/server/.env 或环境变量
CODEPOD_REGISTRY_ENABLED=true              # 启用内置仓库
CODEPOD_REGISTRY_PORT=5000                 # Registry API 端口
CODEPOD_REGISTRY_STORAGE_ROOT=data/registry # 存储路径
CODEPOD_REGISTRY_AUTH_ENABLED=true         # 启用认证
CODEPOD_REGISTRY_EXTERNAL_ENABLED=true    # 启用外部仓库对接
```

## 与 Runner 的集成

```typescript
// Runner 在创建 Sandbox 时可以指定内置镜像
const sandbox = await runner.createSandbox({
  image: 'localhost:5000/python:3.11',  // 使用内置仓库镜像
});
```

## 安全性

1. **认证**：内置仓库使用 API Key 认证
2. **权限**：区分只读和读写权限
3. **存储加密**：敏感配置加密存储
4. **镜像扫描**：预留集成安全扫描接口

## 实现优先级

### Phase 1: 内置仓库核心功能
- [ ] Local FS 存储层
- [ ] Manifest 处理（OCI Image Index）
- [ ] Blob 上传/下载
- [ ] Docker Registry V2 API 兼容端点
- [ ] 镜像和标签 CRUD API

### Phase 2: 外部仓库对接
- [ ] 外部仓库配置管理
- [ ] Harbor/ECR/Docker Hub 客户端
- [ ] 拉取到本地缓存
- [ ] 推送到外部仓库

### Phase 3: 高级功能
- [ ] 镜像签名和验证
- [ ] 镜像扫描集成
- [ ] 存储配额管理
- [ ] 垃圾回收
