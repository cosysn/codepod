# CodePod Server Subsystem Design

## 1. Overview

Server 是 CodePod 的控制平面核心组件，提供 RESTful API 供 CLI 和 SDK 调用，管理 API Key、Sandbox 生命周期、资源配额，并与 Runner 进行通信（通过 gRPC）。

### 1.1 主要职责

- **API Key 管理**：创建、查询、撤销 API Key
- **Sandbox 生命周期管理**：创建、删除、查询 Sandbox 状态
- **资源配额管理**：用户级别的资源限制
- **Runner 协调**：接收 Runner 注册，管理 Runner 池
- **Webhook 管理**：配置 Sandbox 事件通知
- **审计日志**：记录所有操作

### 1.2 技术栈

- **运行时**：Node.js 20 LTS
- **框架**：Express.js / Fastify
- **数据库**：PostgreSQL（主数据存储）
- **缓存**：Redis（会话、速率限制）
- **消息队列**：RabbitMQ / NATS（异步任务）
- **gRPC 客户端**：@grpc/grpc-js（与 Runner 通信）

---

## 2. 架构设计

### 2.1 模块结构

```
apps/server/
├── src/
│   ├── index.ts                    # 应用入口
│   ├── config.ts                   # 配置管理
│   │
│   ├── api/
│   │   ├── routes/
│   │   │   ├── auth.routes.ts      # API Key 管理
│   │   │   ├── sandbox.routes.ts  # Sandbox CRUD
│   │   │   ├── runner.routes.ts    # Runner 管理（可选）
│   │   │   ├── webhook.routes.ts   # Webhook 配置
│   │   │   ├── audit.routes.ts     # 审计日志查询
│   │   │   └── health.routes.ts    # 健康检查
│   │   │
│   │   ├── middleware/
│   │   │   ├── auth.middleware.ts  # API Key 认证
│   │   │   ├── rate-limit.ts       # 速率限制
│   │   │   └── validation.ts       # 请求验证
│   │   │
│   │   └── schemas/               # OpenAPI schemas
│   │
│   ├── services/
│   │   ├── api-key.service.ts     # API Key 服务
│   │   ├── sandbox.service.ts     # Sandbox 服务
│   │   ├── runner.service.ts      # Runner 服务
│   │   ├── webhook.service.ts     # Webhook 服务
│   │   ├── audit.service.ts       # 审计服务
│   │   └── quota.service.ts        # 配额服务
│   │
│   ├── grpc/
│   │   ├── client.ts               # gRPC 客户端
│   │   ├── runner-client.ts        # Runner 通信
│   │   └── types.ts                # gRPC 类型定义
│   │
│   ├── database/
│   │   ├── migrations/             # 数据库迁移
│   │   ├── repositories/           # 数据访问层
│   │   └── entities/               # 实体定义
│   │
│   ├── events/
│   │   ├── event-bus.ts            # 事件总线
│   │   ├── handlers/               # 事件处理器
│   │   └── types.ts                # 事件类型
│   │
│   ├── workers/
│   │   ├── job-worker.ts           # 异步任务处理
│   │   └── cleanup-worker.ts       # 清理任务
│   │
│   └── utils/
│       ├── logger.ts               # 日志工具
│       └── crypto.ts                # 加密工具
│
├── proto/
│   ├── runner/
│   │   └── runner.proto            # Runner 服务定义
│   └── server/
│       └── server.proto            # Server 服务定义（可选）
│
├── prisma/
│   └── schema.prisma              # Prisma 模式定义
│
├── tests/
│   ├── unit/
│   └── integration/
│
├── Dockerfile
├── tsconfig.json
└── package.json
```

### 2.2 数据流

```
┌─────────────────────────────────────────────────────────────────┐
│                          Client (CLI/SDK)                        │
└─────────────────────────┬───────────────────────────────────────┘
                          │ HTTPS/REST
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                           API Gateway                             │
│                    (Express/Fastify Server)                       │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────────┐  │
│  │ Auth Middle │ │ Rate Limit  │ │ Request Validation          │  │
│  └─────────────┘ └─────────────┘ └─────────────────────────────┘  │
└─────────────────────────┬───────────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
    ┌──────────┐   ┌──────────┐   ┌──────────┐
    │ API Key  │   │ Sandbox  │   │ Webhook  │
    │ Service  │   │ Service  │   │ Service  │
    └────┬─────┘   └────┬─────┘   └────┬─────┘
         │              │              │
         ▼              ▼              ▼
    ┌──────────────────────────────────────────────────────────┐
    │                      PostgreSQL                            │
    └──────────────────────────────────────────────────────────┘
                          │
                          ▼
    ┌──────────────────────────────────────────────────────────┐
    │                       Redis Cache                          │
    │  - 会话缓存   - 速率限制   - 临时数据                      │
    └──────────────────────────────────────────────────────────┘
                          │
                          ▼
    ┌──────────────────────────────────────────────────────────┐
    │                    gRPC (双向流)                            │
    │              Runner ↔ Server 通信通道                       │
    └─────────────────────────┬─────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │     Runner Pool      │
                    └─────────────────────┘
```

---

## 3. API 设计

### 3.1 认证与授权

#### API Key 管理

```typescript
// POST /api/v1/auth/api-keys
// 创建新的 API Key
interface CreateApiKeyRequest {
  name: string;           // Key 名称，用于标识
  expiresAt?: string;      // 可选过期时间
  permissions?: string[];  // 可选权限列表
}

interface ApiKeyResponse {
  id: string;
  key: string;            // 完整的 key（仅返回一次）
  name: string;
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
  status: 'active' | 'revoked';
}

// GET /api/v1/auth/api-keys
// 列出所有 API Keys
interface ListApiKeysResponse {
  keys: Array<{
    id: string;
    name: string;
    createdAt: string;
    lastUsedAt?: string;
    expiresAt?: string;
    status: 'active' | 'revoked';
  }>;
}

// DELETE /api/v1/auth/api-keys/:id
// 撤销 API Key
```

#### 认证中间件

```typescript
// src/api/middleware/auth.middleware.ts

import { Request, Response, NextFunction } from 'express';
import { ApiKeyService } from '../services/api-key.service';

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const apiKey = req.headers['x-api-key'] as string;

  if (!apiKey) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'API key is required'
    });
    return;
  }

  try {
    const keyRecord = await ApiKeyService.validate(apiKey);

    if (!keyRecord) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid API key'
      });
      return;
    }

    if (keyRecord.status === 'revoked') {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'API key has been revoked'
      });
      return;
    }

    if (keyRecord.expiresAt && new Date(keyRecord.expiresAt) < new Date()) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'API key has expired'
      });
      return;
    }

    // 附加用户信息到请求
    (req as any).apiKey = keyRecord;
    (req as any).userId = keyRecord.userId;

    // 更新最后使用时间
    await ApiKeyService.updateLastUsed(keyRecord.id);

    next();
  } catch (error) {
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to validate API key'
    });
  }
}
```

### 3.2 Sandbox 管理

#### 创建 Sandbox

```typescript
// POST /api/v1/sandboxes

interface CreateSandboxRequest {
  name?: string;              // 可选名称
  image: string;             // 镜像名称
  version?: string;          // 镜像版本（默认 latest）
  env?: Record<string, string>;  // 环境变量
  resources?: {
    cpu?: number;            // CPU 核心数
    memory?: string;         // 内存限制，如 "512Mi"
    disk?: string;           // 磁盘限制
  };
  timeout?: number;           // 空闲超时时间（秒）
  annotations?: Record<string, string>;  // 标签
}

interface CreateSandboxResponse {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'failed';
  image: string;
  resources: {
    cpu: number;
    memory: string;
    disk: string;
  };
  createdAt: string;
  expiresAt?: string;
  connection?: {
    ssh: {
      host: string;
      port: number;
      user: string;
      authType: 'token' | 'password' | 'publickey';
    };
    ports?: number[];        // 暴露的端口
  };
}
```

#### 获取 Sandbox 信息

```typescript
// GET /api/v1/sandboxes/:id

interface SandboxResponse {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'failed' | 'stopped' | 'archived';
  image: string;
  resources: {
    cpu: number;
    memory: string;
    disk: string;
  };
  env: Record<string, string>;  // 非敏感环境变量
  connection: {
    ssh: {
      host: string;
      port: number;
      user: string;
      token?: string;          // 仅在创建时返回
    };
    ports: number[];
  };
  createdAt: string;
  startedAt?: string;
  stoppedAt?: string;
  annotations?: Record<string, string>;
  metrics?: {
    cpuUsage?: number;
    memoryUsage?: number;
    networkIn?: number;
    networkOut?: number;
  };
}
```

#### 删除 Sandbox

```typescript
// DELETE /api/v1/sandboxes/:id

// 立即删除
DELETE /api/v1/sandboxes/:id

// 延迟删除（保留一段时间）
DELETE /api/v1/sandboxes/:id?gracePeriod=3600
```

#### 列出 Sandboxes

```typescript
// GET /api/v1/sandboxes

interface ListSandboxesQuery {
  status?: string;           // 状态过滤
  image?: string;            // 镜像过滤
  limit?: number;            // 分页限制
  offset?: number;           // 分页偏移
  orderBy?: 'createdAt' | 'name';
  order?: 'asc' | 'desc';
}

interface ListSandboxesResponse {
  sandboxes: SandboxResponse[];
  total: number;
  limit: number;
  offset: number;
}
```

#### 更新 Sandbox

```typescript
// PATCH /api/v1/sandboxes/:id

interface UpdateSandboxRequest {
  name?: string;
  timeout?: number;          // 更新空闲超时
  annotations?: Record<string, string>;
}

interface UpdateSandboxResponse {
  id: string;
  name: string;
  status: string;
  updatedAt: string;
}
```

### 3.3 Runner 管理

```typescript
// GET /api/v1/runners

interface RunnerStatus {
  id: string;
  name: string;
  status: 'online' | 'offline' | 'maintenance';
  capacity: {
    total: number;
    available: number;
    running: number;
  };
  resources: {
    cpu: {
      total: number;
      used: number;
    };
    memory: {
      total: string;
      used: string;
    };
  };
  region?: string;
  lastHeartbeat: string;
}

// GET /api/v1/runners/:id
// 获取特定 Runner 详情

// GET /api/v1/runners/:id/metrics
// 获取 Runner 指标
```

### 3.4 Webhook 管理

```typescript
// POST /api/v1/webhooks

interface CreateWebhookRequest {
  name: string;
  url: string;
  secret?: string;           // 用于签名验证
  events: SandboxEventType[];
  sandboxId?: string;       // 可选，绑定到特定 sandbox
}

type SandboxEventType =
  | 'sandbox.created'
  | 'sandbox.started'
  | 'sandbox.stopped'
  | 'sandbox.deleted'
  | 'sandbox.failed'
  | 'job.completed'
  | 'job.failed';

interface WebhookResponse {
  id: string;
  name: string;
  url: string;
  events: string[];
  status: 'active' | 'inactive';
  createdAt: string;
}

// GET /api/v1/webhooks
// 列出所有 Webhooks

// PATCH /api/v1/webhooks/:id
// 更新 Webhook 配置

// DELETE /api/v1/webhooks/:id
// 删除 Webhook

// POST /api/v1/webhooks/:id/test
// 测试 Webhook
```

### 3.5 审计日志

```typescript
// GET /api/v1/audit

interface AuditQuery {
  userId?: string;
  resourceType?: string;
  action?: string;
  startTime?: string;
  endTime?: string;
  limit?: number;
  offset?: number;
}

interface AuditEntry {
  id: string;
  timestamp: string;
  userId: string;
  apiKeyId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  status: 'success' | 'failure';
  details?: Record<string, any>;
  ipAddress: string;
  userAgent: string;
}
```

### 3.6 健康检查

```typescript
// GET /health
// 简单的健康检查

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  checks: {
    database: boolean;
    redis: boolean;
    grpc: boolean;
  };
}

// GET /health/detailed
// 详细的健康检查（含指标）
```

---

## 4. 服务实现

### 4.1 Sandbox 服务

```typescript
// src/services/sandbox.service.ts

import { prisma } from '../database/client';
import { grpcClient } from '../grpc/client';
import { EventBus } from '../events/event-bus';
import { v4 as uuidv4 } from 'uuid';

export class SandboxService {
  /**
   * 创建 Sandbox
   */
  async createSandbox(
    userId: string,
    apiKeyId: string,
    input: CreateSandboxRequest
  ): Promise<SandboxResponse> {
    // 1. 检查资源配额
    const quota = await this.checkQuota(userId, input.resources);
    if (!quota.allowed) {
      throw new Error(`Quota exceeded: ${quota.reason}`);
    }

    // 2. 选择合适的 Runner（简单的轮询选择）
    const runner = await this.selectRunner(input);
    if (!runner) {
      throw new Error('No available runner');
    }

    // 3. 生成唯一标识
    const sandboxId = uuidv4();
    const name = input.name || `sandbox-${sandboxId.slice(0, 8)}`;

    // 4. 生成本地 SSH token
    const sshToken = this.generateToken();

    // 5. 创建 Sandbox 记录
    const sandbox = await prisma.sandbox.create({
      data: {
        id: sandboxId,
        name,
        userId,
        apiKeyId,
        image: input.image,
        imageVersion: input.version || 'latest',
        env: input.env || {},
        resources: {
          cpu: input.resources?.cpu || 1,
          memory: input.resources?.memory || '512Mi',
          disk: input.resources?.disk || '10Gi',
        },
        timeout: input.timeout || 3600,
        status: 'pending',
        sshToken,
        annotations: input.annotations,
      },
    });

    // 6. 通过 gRPC 通知 Runner 创建 Sandbox
    try {
      await grpcClient.submitJob({
        jobId: uuidv4(),
        runnerId: runner.id,
        type: 'JOB_CREATE_SANDBOX',
        payload: {
          sandboxId,
          image: input.image,
          version: input.version,
          env: input.env,
          resources: input.resources,
          timeout: input.timeout,
          annotations: input.annotations,
        },
        priority: 1,
      });
    } catch (error) {
      // gRPC 调用失败，更新状态
      await prisma.sandbox.update({
        where: { id: sandboxId },
        data: { status: 'failed' },
      });
      throw error;
    }

    // 7. 触发事件
    await EventBus.publish('sandbox.created', {
      sandboxId,
      userId,
      image: input.image,
    });

    // 8. 返回结果
    return this.formatSandboxResponse(sandbox);
  }

  /**
   * 获取 Sandbox 详情
   */
  async getSandbox(sandboxId: string, userId: string): Promise<SandboxResponse | null> {
    const sandbox = await prisma.sandbox.findUnique({
      where: { id: sandboxId },
    });

    if (!sandbox || sandbox.userId !== userId) {
      return null;
    }

    // 尝试从 Runner 获取实时状态
    if (sandbox.status === 'running' && sandbox.runnerId) {
      try {
        const runnerStatus = await grpcClient.getSandboxStatus(
          sandbox.runnerId,
          sandboxId
        );
        if (runnerStatus) {
          await prisma.sandbox.update({
            where: { id: sandboxId },
            data: {
              status: runnerStatus.status,
              metrics: runnerStatus.metrics,
            },
          });
        }
      } catch (error) {
        // 忽略获取状态的错误
      }
    }

    return this.formatSandboxResponse(sandbox);
  }

  /**
   * 删除 Sandbox
   */
  async deleteSandbox(
    sandboxId: string,
    userId: string,
    gracePeriod?: number
  ): Promise<void> {
    const sandbox = await prisma.sandbox.findUnique({
      where: { id: sandboxId },
    });

    if (!sandbox || sandbox.userId !== userId) {
      throw new Error('Sandbox not found');
    }

    if (sandbox.status === 'pending') {
      throw new Error('Cannot delete sandbox in pending status');
    }

    if (gracePeriod && gracePeriod > 0) {
      // 软删除 - 延迟删除
      await prisma.sandbox.update({
        where: { id: sandboxId },
        data: {
          status: 'archived',
          archivedAt: new Date(Date.now() + gracePeriod * 1000),
        },
      });

      // 安排后台任务删除
      await EventBus.publish('sandbox.scheduled-delete', {
        sandboxId,
        deleteAt: new Date(Date.now() + gracePeriod * 1000),
      });
    } else {
      // 立即删除
      await this.forceDeleteSandbox(sandboxId);
    }
  }

  /**
   * 强制删除 Sandbox
   */
  private async forceDeleteSandbox(sandboxId: string): Promise<void> {
    const sandbox = await prisma.sandbox.findUnique({
      where: { id: sandboxId },
    });

    if (!sandbox) {
      return;
    }

    // 如果有 Runner，通知删除
    if (sandbox.runnerId && sandbox.status === 'running') {
      try {
        await grpcClient.submitJob({
          jobId: uuidv4(),
          runnerId: sandbox.runnerId,
          type: 'JOB_DELETE_SANDBOX',
          payload: { sandboxId },
          priority: 10,  // 高优先级
        });
      } catch (error) {
        // 记录错误但继续删除记录
        console.error(`Failed to notify runner for deletion: ${error}`);
      }
    }

    // 更新状态
    await prisma.sandbox.update({
      where: { id: sandboxId },
      data: { status: 'deleting' },
    });

    // 删除记录
    await prisma.sandbox.delete({
      where: { id: sandboxId },
    });

    await EventBus.publish('sandbox.deleted', {
      sandboxId,
      userId: sandbox.userId,
    });
  }

  /**
   * 选择 Runner
   */
  private async selectRunner(input: CreateSandboxRequest): Promise<any> {
    // 获取可用的 Runner
    const runners = await prisma.runner.findMany({
      where: {
        status: 'online',
        capacity: {
          available: { gt: 0 },
        },
      },
      orderBy: {
        sandboxes: {
          _count: 'asc',  // 负载均衡
        },
      },
      take: 1,
    });

    if (runners.length === 0) {
      return null;
    }

    return runners[0];
  }

  /**
   * 检查配额
   */
  private async checkQuota(
    userId: string,
    resources?: CreateSandboxRequest['resources']
  ): Promise<{ allowed: boolean; reason?: string }> {
    const quota = await prisma.quota.findUnique({
      where: { userId },
    });

    if (!quota) {
      return { allowed: true };
    }

    // 检查当前使用的资源
    const currentUsage = await prisma.sandbox.groupBy({
      by: ['userId'],
      where: {
        userId,
        status: { in: ['pending', 'running'] },
      },
      _count: true,
    });

    const runningCount = currentUsage[0]?._count || 0;

    if (runningCount >= quota.maxSandboxes) {
      return { allowed: false, reason: 'Maximum sandboxes reached' };
    }

    // TODO: 检查 CPU/内存配额

    return { allowed: true };
  }

  /**
   * 生成 SSH Token
   */
  private generateToken(): string {
    return `cp_${uuidv4().replace(/-/g, '')}`;
  }

  /**
   * 格式化响应
   */
  private formatSandboxResponse(sandbox: any): SandboxResponse {
    return {
      id: sandbox.id,
      name: sandbox.name,
      status: sandbox.status,
      image: `${sandbox.image}:${sandbox.imageVersion}`,
      resources: {
        cpu: sandbox.resources.cpu,
        memory: sandbox.resources.memory,
        disk: sandbox.resources.disk,
      },
      createdAt: sandbox.createdAt.toISOString(),
      expiresAt: sandbox.timeout
        ? new Date(sandbox.createdAt.getTime() + sandbox.timeout * 1000).toISOString()
        : undefined,
      connection: {
        ssh: {
          host: `${sandbox.id}.sandbox.local`,
          port: 22,
          user: 'root',
          authType: 'token',
        },
        ports: sandbox.exposedPorts || [],
      },
    };
  }
}
```

### 4.2 API Key 服务

```typescript
// src/services/api-key.service.ts

import { prisma } from '../database/client';
import crypto from 'crypto';

export class ApiKeyService {
  /**
   * 创建 API Key
   */
  async createApiKey(
    userId: string,
    input: CreateApiKeyRequest
  ): Promise<ApiKeyResponse> {
    // 生成 API Key
    const keyId = crypto.randomUUID();
    const keySecret = `cp_${crypto.randomBytes(32).toString('hex')}`;
    const keyHash = this.hashKey(keySecret);

    const apiKey = await prisma.apiKey.create({
      data: {
        id: keyId,
        keyHash,
        name: input.name,
        userId,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        permissions: input.permissions || [],
        status: 'active',
      },
    });

    // 返回完整的 key（仅此一次）
    const fullKey = `cp_${keyId}_${keySecret}`;
    return {
      id: apiKey.id,
      key: fullKey,
      name: apiKey.name,
      createdAt: apiKey.createdAt.toISOString(),
      expiresAt: apiKey.expiresAt?.toISOString(),
      status: apiKey.status,
    };
  }

  /**
   * 验证 API Key
   */
  async validate(apiKey: string): Promise<any> {
    if (!apiKey.startsWith('cp_')) {
      return null;
    }

    const parts = apiKey.split('_');
    if (parts.length !== 3) {
      return null;
    }

    const [prefix, keyId, keySecret] = parts;
    const keyHash = this.hashKey(keySecret);

    const apiKeyRecord = await prisma.apiKey.findUnique({
      where: { id: keyId },
    });

    if (!apiKeyRecord) {
      return null;
    }

    if (apiKeyRecord.status !== 'active') {
      return null;
    }

    if (apiKeyRecord.keyHash !== keyHash) {
      return null;
    }

    if (apiKeyRecord.expiresAt && apiKeyRecord.expiresAt < new Date()) {
      return null;
    }

    return apiKeyRecord;
  }

  /**
   * 更新最后使用时间
   */
  async updateLastUsed(keyId: string): Promise<void> {
    await prisma.apiKey.update({
      where: { id: keyId },
      data: { lastUsedAt: new Date() },
    });
  }

  /**
   * 撤销 API Key
   */
  async revokeApiKey(keyId: string, userId: string): Promise<void> {
    const apiKey = await prisma.apiKey.findUnique({
      where: { id: keyId },
    });

    if (!apiKey || apiKey.userId !== userId) {
      throw new Error('API key not found');
    }

    await prisma.apiKey.update({
      where: { id: keyId },
      data: { status: 'revoked' },
    });
  }

  /**
   * 列出用户的 API Keys
   */
  async listApiKeys(userId: string): Promise<any[]> {
    const keys = await prisma.apiKey.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
        status: true,
      },
    });

    return keys;
  }

  /**
   * Hash key 用于存储
   */
  private hashKey(key: string): string {
    return crypto.createHash('sha256').update(key).digest('hex');
  }
}
```

---

## 5. Runner 通信

### 5.1 gRPC 客户端

```typescript
// src/grpc/client.ts

import * as grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import path from 'path';

const RUNNER_PROTO_PATH = path.join(__dirname, '../../proto/runner/runner.proto');

const packageDefinition = protoLoader.loadSync(RUNNER_PROTO_PATH, {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const runnerProto = grpc.loadPackageDefinition(packageDefinition).runner as any;

export class GrpcClient {
  private clients: Map<string, any> = new Map();
  private connection: grpc.Client | null = null;

  /**
   * 连接到 Server gRPC 服务
   */
  async connect(serverAddress: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.connection = new runnerProto.RunnerService(
        serverAddress,
        grpc.credentials.createInsecure()
      );

      this.connection.on('error', (err) => {
        console.error('gRPC connection error:', err);
      });

      this.connection.on('connect', () => {
        console.log('Connected to gRPC server');
        resolve();
      });

      this.connection.on('close', () => {
        console.log('gRPC connection closed');
      });
    });
  }

  /**
   * 提交 Job 到 Runner
   */
  async submitJob(params: {
    jobId: string;
    runnerId: string;
    type: string;
    payload: Record<string, any>;
    priority: number;
  }): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.connection) {
        reject(new Error('Not connected to gRPC server'));
        return;
      }

      this.connection.SubmitJob(
        {
          jobId: params.jobId,
          runnerId: params.runnerId,
          type: params.type,
          payload: JSON.stringify(params.payload),
          priority: params.priority,
        },
        (error: any, response: any) => {
          if (error) {
            reject(error);
          } else {
            resolve(response);
          }
        }
      );
    });
  }

  /**
   * 获取 Sandbox 状态
   */
  async getSandboxStatus(runnerId: string, sandboxId: string): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.connection) {
        reject(new Error('Not connected to gRPC server'));
        return;
      }

      const client = this.clients.get(runnerId) || this.connection;

      client.GetSandboxStatus(
        { sandboxId },
        (error: any, response: any) => {
          if (error) {
            reject(error);
          } else {
            resolve(response);
          }
        }
      );
    });
  }

  /**
   * 发送控制命令
   */
  async sendControlCommand(
    runnerId: string,
    sandboxId: string,
    command: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.connection) {
        reject(new Error('Not connected to gRPC server'));
        return;
      }

      const client = this.clients.get(runnerId) || this.connection;

      client.SendControlCommand(
        {
          sandboxId,
          command,
        },
        (error: any) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        }
      );
    });
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    return new Promise((resolve) => {
      if (this.connection) {
        this.connection.close();
        this.connection = null;
      }
      resolve();
    });
  }
}

export const grpcClient = new GrpcClient();
```

---

## 6. 事件处理

### 6.1 事件总线

```typescript
// src/events/event-bus.ts

import { EventEmitter } from 'events';

export class EventBus extends EventEmitter {
  private static instance: EventBus;

  static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  /**
   * 发布事件
   */
  async publish(event: string, data: any): Promise<void> {
    // 同步触发本地订阅
    this.emit(event, data);

    // TODO: 发布到消息队列，供分布式部署使用
  }

  /**
   * 订阅事件
   */
  subscribe(event: string, handler: (data: any) => void): void {
    this.on(event, handler);
  }

  /**
   * 取消订阅
   */
  unsubscribe(event: string, handler?: (data: any) => void): void {
    if (handler) {
      this.off(event, handler);
    } else {
      this.removeAllListeners(event);
    }
  }
}
```

### 6.2 事件处理器

```typescript
// src/events/handlers/sandbox.handler.ts

import { EventBus } from '../event-bus';
import { webhookService } from '../../services/webhook.service';
import { auditService } from '../../services/audit.service';

export class SandboxEventHandler {
  constructor() {
    this.registerHandlers();
  }

  private registerHandlers(): void {
    const bus = EventBus.getInstance();

    bus.subscribe('sandbox.created', async (data) => {
      // 发送 webhook
      await webhookService.dispatch('sandbox.created', data);

      // 记录审计日志
      await auditService.log({
        action: 'sandbox.create',
        resourceType: 'sandbox',
        resourceId: data.sandboxId,
        userId: data.userId,
        status: 'success',
        details: { image: data.image },
      });
    });

    bus.subscribe('sandbox.started', async (data) => {
      await webhookService.dispatch('sandbox.started', data);
    });

    bus.subscribe('sandbox.deleted', async (data) => {
      await webhookService.dispatch('sandbox.deleted', data);

      await auditService.log({
        action: 'sandbox.delete',
        resourceType: 'sandbox',
        resourceId: data.sandboxId,
        userId: data.userId,
        status: 'success',
      });
    });

    bus.subscribe('sandbox.failed', async (data) => {
      await webhookService.dispatch('sandbox.failed', data);

      await auditService.log({
        action: 'sandbox.create',
        resourceType: 'sandbox',
        resourceId: data.sandboxId,
        userId: data.userId,
        status: 'failure',
        details: { error: data.error },
      });
    });
  }
}
```

---

## 7. 异步任务处理

### 7.1 Job Worker

```typescript
// src/workers/job-worker.ts

import { EventBus } from '../events/event-bus';

export class JobWorker {
  private isRunning: boolean = false;
  private workers: Worker[] = [];

  constructor(private concurrency: number = 5) {}

  /**
   * 启动 Worker
   */
  async start(): Promise<void> {
    this.isRunning = true;

    for (let i = 0; i < this.concurrency; i++) {
      const worker = new Worker(`job-worker-${i}`);
      this.workers.push(worker);
      await worker.start();
    }
  }

  /**
   * 停止 Worker
   */
  async stop(): Promise<void> {
    this.isRunning = false;

    for (const worker of this.workers) {
      await worker.stop();
    }
    this.workers = [];
  }
}

class Worker {
  private isProcessing: boolean = false;

  constructor(private name: string) {}

  async start(): Promise<void> {
    this.isProcessing = true;
    this.processLoop();
  }

  async stop(): Promise<void> {
    this.isProcessing = false;
  }

  private async processLoop(): Promise<void> {
    while (this.isProcessing) {
      try {
        // 从队列获取任务
        const job = await this.getJobFromQueue();
        if (job) {
          await this.processJob(job);
        } else {
          // 空闲等待
          await this.sleep(1000);
        }
      } catch (error) {
        console.error(`[${this.name}] Error processing job:`, error);
        await this.sleep(5000);
      }
    }
  }

  private async getJobFromQueue(): Promise<any> {
    // 从 RabbitMQ/NATS 获取任务
    return null;  // TODO: 实现
  }

  private async processJob(job: any): Promise<void> {
    console.log(`[${this.name}] Processing job: ${job.id}`);

    switch (job.type) {
      case 'DELETE_ARCHIVED':
        await this.handleDeleteArchived(job);
        break;
      case 'CLEANUP_ORPHANS':
        await this.handleCleanupOrphans(job);
        break;
      default:
        console.warn(`[${this.name}] Unknown job type: ${job.type}`);
    }
  }

  private async handleDeleteArchived(job: any): Promise<void> {
    const { sandboxId } = job.payload;
    // 清理已归档的 sandbox
  }

  private async handleCleanupOrphans(job: any): Promise<void> {
    // 清理孤立资源
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```

---

## 8. 数据库模型

### 8.1 Prisma Schema

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// 用户 API Keys
model ApiKey {
  id          String    @id @default(uuid())
  keyHash     String    @unique
  name        String
  userId      String
  permissions String[]
  status      ApiKeyStatus @default(active)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  lastUsedAt  DateTime?
  expiresAt   DateTime?

  @@index([userId])
}

enum ApiKeyStatus {
  active
  revoked
}

// Sandbox 实例
model Sandbox {
  id            String         @id @default(uuid())
  name          String
  userId        String
  apiKeyId      String
  runnerId      String?
  image         String
  imageVersion  String         @default("latest")
  status        SandboxStatus  @default(pending)
  resources     Json
  env           Json?
  sshToken      String?
  timeout       Int            @default(3600)
  annotations   Json?
  exposedPorts  Int[]
  metrics       Json?
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt
  startedAt     DateTime?
  stoppedAt     DateTime?
  archivedAt    DateTime?

  @@index([userId])
  @@index([runnerId])
  @@index([status])
}

enum SandboxStatus {
  pending
  running
  failed
  stopped
  deleting
  archived
}

// Runner 注册表
model Runner {
  id          String       @id @default(uuid())
  name        String
  address     String
  status      RunnerStatus @default(offline)
  capacity    Json
  resources   Json
  region      String?
  metadata    Json?
  lastHeartbeat DateTime   @default(now())
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt

  @@unique([address])
  @@index([status])
}

enum RunnerStatus {
  online
  offline
  maintenance
}

// 用户配额
model Quota {
  userId        String   @id
  maxSandboxes  Int      @default(10)
  maxCpu        Int      @default(100)
  maxMemory     String   @default("100Gi")
  maxDisk       String   @default("1Ti")
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

// Webhook 配置
model Webhook {
  id          String          @id @default(uuid())
  name        String
  url         String
  secret      String?
  events     String[]
  status      WebhookStatus   @default(active)
  sandboxId   String?
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt

  @@index([sandboxId])
}

enum WebhookStatus {
  active
  inactive
}

// Webhook 发送记录
model WebhookLog {
  id          String   @id @default(uuid())
  webhookId   String
  event       String
  payload     Json
  statusCode  Int?
  response    String?
  error       String?
  retryCount  Int      @default(0)
  createdAt   DateTime @default(now())

  @@index([webhookId])
}

// 审计日志
model AuditLog {
  id           String   @id @default(uuid())
  userId       String
  apiKeyId     String
  action       String
  resourceType String
  resourceId   String
  status       String
  details      Json?
  ipAddress    String
  userAgent    String
  createdAt    DateTime @default(now())

  @@index([userId])
  @@index([resourceType])
  @@index([createdAt])
}
```

---

## 9. 部署配置

### 9.1 Dockerfile

```dockerfile
# apps/server/Dockerfile

FROM node:20-alpine

WORKDIR /app

# 安装依赖
COPY package*.json ./
RUN npm ci --only=production

# 复制 proto 文件
COPY proto/ ./proto/

# 复制源码
COPY src/ ./src/
COPY prisma/ ./prisma/

# 生成 Prisma Client
RUN npx prisma generate

# 构建 TypeScript
RUN npm run build

# 创建非 root 用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

USER nodejs

EXPOSE 3000

CMD ["node", "dist/index.js"]
```

### 9.2 环境变量

```bash
# apps/server/.env.example

# 服务配置
NODE_ENV=production
PORT=3000
LOG_LEVEL=info

# 数据库
DATABASE_URL=postgresql://user:pass@localhost:5432/codepod

# Redis
REDIS_URL=redis://localhost:6379

# 消息队列
RABBITMQ_URL=amqp://localhost:5672

# gRPC Server
GRPC_PORT=50051

# Runner gRPC Server 地址
RUNNER_GRPC_SERVER=runner-service:50051

# Webhook 回调超时（毫秒）
WEBHOOK_TIMEOUT=30000

# 速率限制
RATE_LIMIT_WINDOW=60000
RATE_LIMIT_MAX=100
```

---

## 10. 监控指标

### 10.1 Prometheus 指标

```typescript
// src/utils/metrics.ts

import { Registry, Counter, Histogram, Gauge } from 'prom-client';

const registry = new Registry();

// API 请求计数
export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'path', 'status'],
  registers: [registry],
});

// Sandbox 操作计数
export const sandboxOperationsTotal = new Counter({
  name: 'sandbox_operations_total',
  help: 'Total number of sandbox operations',
  labelNames: ['operation', 'status'],
  registers: [registry],
});

// Sandbox 创建延迟
export const sandboxCreationDuration = new Histogram({
  name: 'sandbox_creation_duration_seconds',
  help: 'Time spent creating sandboxes',
  labelNames: ['image'],
  buckets: [1, 5, 10, 30, 60, 120],
  registers: [registry],
});

// 当前活跃 Sandbox 数量
export const activeSandboxes = new Gauge({
  name: 'active_sandboxes',
  help: 'Number of currently active sandboxes',
  registers: [registry],
});

// Runner 数量
export const runnerCount = new Gauge({
  name: 'runner_count',
  help: 'Number of registered runners',
  labelNames: ['status'],
  registers: [registry],
});
```

---

## 11. 目录结构总结

```
apps/server/
├── src/
│   ├── index.ts                    # 应用入口，初始化所有组件
│   ├── config.ts                   # 配置加载（环境变量）
│   │
│   ├── api/
│   │   ├── routes/                 # Express 路由
│   │   │   ├── auth.routes.ts      # API Key 管理端点
│   │   │   ├── sandbox.routes.ts   # Sandbox CRUD 端点
│   │   │   ├── runner.routes.ts    # Runner 监控端点
│   │   │   ├── webhook.routes.ts   # Webhook 配置端点
│   │   │   ├── audit.routes.ts     # 审计日志端点
│   │   │   └── health.routes.ts    # 健康检查端点
│   │   ├── middleware/
│   │   │   ├── auth.middleware.ts  # API Key 认证中间件
│   │   │   ├── rate-limit.ts       # 速率限制中间件
│   │   │   └── validation.ts       # 请求体验证中间件
│   │   └── schemas/                # OpenAPI JSON Schema
│   │
│   ├── services/                   # 业务逻辑层
│   │   ├── api-key.service.ts      # API Key 创建、验证、撤销
│   │   ├── sandbox.service.ts     # Sandbox 生命周期管理
│   │   ├── runner.service.ts       # Runner 注册、状态管理
│   │   ├── webhook.service.ts      # Webhook 触发、日志
│   │   ├── audit.service.ts        # 审计日志记录、查询
│   │   └── quota.service.ts        # 配额检查、管理
│   │
│   ├── grpc/
│   │   ├── client.ts               # gRPC 客户端封装
│   │   └── types.ts                # gRPC 消息类型定义
│   │
│   ├── database/
│   │   ├── client.ts               # Prisma 客户端实例
│   │   ├── migrations/              # 数据库迁移文件
│   │   ├── repositories/           # 数据访问层封装
│   │   └── entities/               # 实体类型定义
│   │
│   ├── events/
│   │   ├── event-bus.ts            # 事件总线实现
│   │   ├── handlers/                # 事件处理逻辑
│   │   │   ├── sandbox.handler.ts  # Sandbox 事件处理
│   │   │   └── webhook.handler.ts  # Webhook 事件触发
│   │   └── types.ts                # 事件类型定义
│   │
│   ├── workers/
│   │   ├── job-worker.ts           # 异步任务工作池
│   │   └── cleanup-worker.ts        # 资源清理工作
│   │
│   └── utils/
│       ├── logger.ts                # 结构化日志封装
│       ├── metrics.ts               # Prometheus 指标
│       └── crypto.ts                # 加密工具函数
│
├── proto/                          # Protocol Buffer 定义
│   ├── runner/
│   │   └── runner.proto            # Runner 服务接口
│   └── server/
│       └── server.proto            # Server 服务接口（可选）
│
├── prisma/
│   ├── schema.prisma               # 数据库模型定义
│   └── migrations/                 # 迁移文件
│
├── tests/
│   ├── unit/                       # 单元测试
│   ├── integration/                # 集成测试
│   └── e2e/                        # 端到端测试
│
├── Dockerfile                      # Docker 构建文件
├── docker-compose.yml              # 本地开发编排
├── tsconfig.json                   # TypeScript 配置
├── jest.config.js                  # Jest 测试配置
└── package.json                    # 依赖配置
```

---

## 12. 关键接口定义

### 12.1 CreateSandboxRequest

```typescript
interface CreateSandboxRequest {
  /** 可选的 Sandbox 名称 */
  name?: string;
  /** 镜像名称（必需） */
  image: string;
  /** 镜像版本（默认 latest） */
  version?: string;
  /** 环境变量 */
  env?: Record<string, string>;
  /** 资源限制 */
  resources?: {
    /** CPU 核心数（默认 1） */
    cpu?: number;
    /** 内存限制（默认 512Mi） */
    memory?: string;
    /** 磁盘限制（默认 10Gi） */
    disk?: string;
  };
  /** 空闲超时时间（秒，默认 3600） */
  timeout?: number;
  /** 自定义标签 */
  annotations?: Record<string, string>;
}
```

### 12.2 SandboxResponse

```typescript
interface SandboxResponse {
  /** Sandbox 唯一标识 */
  id: string;
  /** Sandbox 名称 */
  name: string;
  /** 当前状态 */
  status: 'pending' | 'running' | 'failed' | 'stopped' | 'archived';
  /** 镜像名称:版本 */
  image: string;
  /** 资源分配 */
  resources: {
    cpu: number;
    memory: string;
    disk: string;
  };
  /** 创建时间 */
  createdAt: string;
  /** 预期销毁时间（基于 timeout） */
  expiresAt?: string;
  /** 连接信息 */
  connection: {
    /** SSH 连接信息 */
    ssh: {
      host: string;
      port: number;
      user: string;
      authType: 'token' | 'password' | 'publickey';
    };
    /** 暴露的端口列表 */
    ports: number[];
  };
  /** 标签 */
  annotations?: Record<string, string>;
}
```
