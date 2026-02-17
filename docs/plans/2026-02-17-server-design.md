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
- **数据库**：SQLite（默认）/ PostgreSQL（可选）
- **缓存**：内存缓存（默认）/ Redis（可选，会话、速率限制）
- **消息队列**：内存队列（默认）/ RabbitMQ / NATS（可选，异步任务）
- **gRPC 服务端**：@grpc/grpc-js（接收 Runner 连接）
- **安全**：Helmet、CORS、压缩

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
    │                      SQLite / PostgreSQL                    │
    └──────────────────────────────────────────────────────────┘
                          │
                          ▼
    ┌──────────────────────────────────────────────────────────┐
    │                    gRPC Server (Port 50051)               │
    │              接收 Runner 连接 (反向隧道)                   │
    │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐ │
    │  │ Runner Reg │ │ Job Receive │ │ Status Report       │ │
    │  └─────────────┘ └─────────────┘ └─────────────────────┘ │
    └─────────────────────────┬───────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │     Runner Pool      │  (通过反向隧道连接)
                    └─────────────────────┘
```

### 2.3 Runner 连接架构

由于 Runner 可能部署在 NAT 防火墙后面，**Server 作为 gRPC Server 监听端口，Runner 主动连接 Server**（反向隧道）：

```
                        ┌─────────────────────────┐
                        │      防火墙/NAT          │
                        └───────────┬─────────────┘
                                    │
         ┌──────────────────────────┼──────────────────────────┐
         │                          │                          │
         ▼                          ▼                          ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Runner 1      │    │   Runner 2      │    │   Runner N      │
│  (DinD/K8s)     │    │  (独立主机)      │    │  (云服务器)      │
│                 │    │                 │    │                 │
│  ┌───────────┐  │    │  ┌───────────┐  │    │  ┌───────────┐  │
│  │ gRPC Cli │──┼────┼─▶│ gRPC Cli │──┼────┼─▶│ gRPC Cli │──┼──┐
│  └───────────┘  │    │  └───────────┘  │    │  └───────────┘  │  │
└─────────────────┘    └─────────────────┘    └─────────────────┘  │
                                                                         │
                        ┌─────────────────────────┐                    │
                        │     Server (公网IP)      │◀──────────────────┘
                        │  ┌───────────────────┐  │
                        │  │ gRPC Server :50051│  │
                        │  │ - Register        │  │
                        │  │ - Heartbeat       │  │
                        │  │ - ReportStatus    │  │
                        │  └───────────────────┘  │
                        │  ┌───────────────────┐  │
                        │  │ REST API :3000    │  │
                        │  └───────────────────┘  │
                        └─────────────────────────┘
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

#### 快照管理

```typescript
// POST /api/v1/sandboxes/:id/snapshots
// 创建快照

interface CreateSnapshotRequest {
  name: string;              // 快照名称
  description?: string;       // 描述
  includeVolumes?: boolean;    // 是否包含数据卷（默认 true）
}

interface SnapshotResponse {
  id: string;
  sandboxId: string;
  name: string;
  description?: string;
  size: string;
  status: 'creating' | 'ready' | 'failed';
  createdAt: string;
}

// GET /api/v1/sandboxes/:id/snapshots
// 列出快照

interface ListSnapshotsResponse {
  snapshots: SnapshotResponse[];
}

// POST /api/v1/sandboxes/:id/snapshots/:snapshotId/restore
// 恢复快照（会重启 Sandbox）

interface RestoreSnapshotRequest {
  force?: boolean;           // 强制恢复（即使有活跃连接）
}

// DELETE /api/v1/sandboxes/:id/snapshots/:snapshotId
// 删除快照
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

### 3.7 镜像管理

```typescript
// GET /api/v1/images
// 列出可用镜像

interface ImageInfo {
  name: string;
  tag: string;
  size: string;
  description?: string;
  defaultResources?: {
    cpu: number;
    memory: string;
  };
  labels?: string[];
}

interface ListImagesResponse {
  images: ImageInfo[];
  total: number;
}

// GET /api/v1/images/:name/tags
// 列出镜像的可用标签

interface ListImageTagsResponse {
  name: string;
  tags: string[];
}
```

### 3.8 Sandbox 指标历史

```typescript
// GET /api/v1/sandboxes/:id/metrics
// 获取 Sandbox 指标历史

interface GetMetricsQuery {
  startTime?: string;    // 开始时间
  endTime?: string;      // 结束时间
  interval?: string;     // 聚合间隔：1m, 5m, 1h, 1d
  limit?: number;        // 最大数据点
}

interface MetricDataPoint {
  timestamp: string;
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: string;
  networkIn: number;
  networkOut: number;
}

interface GetMetricsResponse {
  sandboxId: string;
  interval: string;
  dataPoints: MetricDataPoint[];
  summary: {
    avgCpuUsage: number;
    maxCpuUsage: number;
    avgMemoryUsage: number;
    maxMemoryUsage: number;
  };
}
```

### 3.9 系统配置管理

```typescript
// GET /api/v1/config
// 获取系统配置

interface SystemConfig {
  sandbox: {
    defaultTimeout: number;
    maxTimeout: number;
    defaultCpu: number;
    defaultMemory: string;
  };
  quota: {
    defaultMaxSandboxes: number;
    defaultMaxCpu: number;
    defaultMaxMemory: string;
  };
  runner: {
    heartbeatInterval: number;
    statusReportInterval: number;
  };
}

// PATCH /api/v1/config
// 更新系统配置（仅管理员）

interface UpdateConfigRequest {
  sandbox?: {
    defaultTimeout?: number;
    maxTimeout?: number;
    defaultCpu?: number;
    defaultMemory?: string;
  };
  quota?: {
    defaultMaxSandboxes?: number;
    defaultMaxCpu?: number;
    defaultMaxMemory?: string;
  };
}
```

### 3.10 错误处理

```typescript
// 统一错误响应格式

interface ErrorResponse {
  error: string;
  message: string;
  code: string;
  details?: Record<string, any>;
  requestId?: string;
  timestamp: string;
}

// 错误码定义

enum ErrorCode {
  // 认证错误 (4xx)
  AUTH_REQUIRED = 'AUTH_REQUIRED',
  AUTH_INVALID_KEY = 'AUTH_INVALID_KEY',
  AUTH_EXPIRED_KEY = 'AUTH_EXPIRED_KEY',
  AUTH_REVOKED_KEY = 'AUTH_REVOKED_KEY',

  // 资源错误 (4xx)
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  RESOURCE_EXISTS = 'RESOURCE_EXISTS',
  RESOURCE_LIMIT_EXCEEDED = 'RESOURCE_LIMIT_EXCEEDED',

  // 操作错误 (4xx)
  OPERATION_INVALID = 'OPERATION_INVALID',
  OPERATION_FORBIDDEN = 'OPERATION_FORBIDDEN',
  OPERATION_CONFLICT = 'OPERATION_CONFLICT',

  // 服务错误 (5xx)
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  GRPC_ERROR = 'GRPC_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
}

// 错误中间件

interface AppError extends Error {
  code: ErrorCode;
  statusCode: number;
  details?: Record<string, any>;
}

function errorMiddleware(
  err: AppError,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const requestId = (req as any).requestId;

  res.status(err.statusCode || 500).json({
    error: err.code,
    message: err.message,
    details: err.details,
    requestId,
    timestamp: new Date().toISOString(),
  });
}
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
    const selector = new RunnerSelector();
    return await selector.select(input);
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

### 4.3 Runner 选择策略

```typescript
// src/services/runner-selector.ts

import { prisma } from '../database/client';

interface RunnerRequirements {
  cpu?: number;
  memory?: string;
  disk?: string;
  region?: string;
  gpu?: boolean;
  minAvailable?: number;
}

interface RunnerInfo {
  id: string;
  name: string;
  status: string;
  capacity: {
    total: number;
    available: number;
    used: number;
  };
  resources: {
    cpu: { total: number; used: number };
    memory: { total: string; used: string };
  };
  region?: string;
  metadata?: Record<string, string>;
  lastHeartbeat: Date;
  score: number;
}

export class RunnerSelector {
  /**
   * 选择 Runner
   */
  async select(requirements: RunnerRequirements): Promise<RunnerInfo | null> {
    const candidates = await this.getCandidates(requirements);
    if (candidates.length === 0) {
      return null;
    }

    // 按区域过滤
    let filtered = candidates;
    if (requirements.region) {
      const regionMatch = candidates.filter(r => r.region === requirements.region);
      if (regionMatch.length > 0) {
        filtered = regionMatch;
      }
    }

    // 计算得分
    const scored = filtered.map(runner => ({
      ...runner,
      score: this.calculateScore(runner, requirements),
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored[0] || null;
  }

  private async getCandidates(requirements: RunnerRequirements): Promise<RunnerInfo[]> {
    const runners = await prisma.runner.findMany({
      where: { status: 'online' },
      include: {
        sandboxes: { where: { status: { in: ['pending', 'running'] } } },
      },
    });

    return runners.map(runner => {
      const capacity = JSON.parse(runner.capacity);
      const resources = JSON.parse(runner.resources);
      const metadata = runner.metadata ? JSON.parse(runner.metadata) : {};

      return {
        id: runner.id,
        name: runner.name,
        status: runner.status,
        capacity: {
          total: capacity.total || 10,
          available: capacity.available || 5,
          used: runner.sandboxes.length,
        },
        resources: {
          cpu: { total: resources.cpu?.total || 16, used: resources.cpu?.used || 0 },
          memory: { total: resources.memory?.total || '64Gi', used: resources.memory?.used || '0' },
        },
        region: runner.region,
        metadata,
        lastHeartbeat: runner.lastHeartbeat,
        score: 0,
      };
    });
  }

  private calculateScore(runner: RunnerInfo, requirements: RunnerRequirements): number {
    let score = 100;

    const availableRatio = runner.capacity.available / runner.capacity.total;
    score += availableRatio * 30;

    const cpuAvailable = runner.resources.cpu.total - runner.resources.cpu.used;
    const cpuRequired = requirements.cpu || 1;
    if (cpuAvailable < cpuRequired) return -Infinity;
    score += (cpuAvailable / runner.resources.cpu.total) * 20;

    const memAvailable = this.parseMemory(runner.resources.memory.total) -
                        this.parseMemory(runner.resources.memory.used);
    const memRequired = this.parseMemory(requirements.memory || '512Mi');
    if (memAvailable < memRequired) return -Infinity;
    score += (memAvailable / this.parseMemory(runner.resources.memory.total)) * 20;

    const loadRatio = runner.capacity.used / runner.capacity.total;
    score -= loadRatio * 20;

    const heartbeatAge = Date.now() - runner.lastHeartbeat.getTime();
    const heartbeatScore = Math.max(0, 1 - heartbeatAge / 60000);
    score += heartbeatScore * 10;

    return score;
  }

  private parseMemory(mem: string): number {
    const units: Record<string, number> = {
      'Ki': 1024, 'Mi': 1024 ** 2, 'Gi': 1024 ** 3, 'Ti': 1024 ** 4,
    };
    for (const [unit, factor] of Object.entries(units)) {
      if (mem.endsWith(unit)) return parseFloat(mem) * factor;
    }
    return parseFloat(mem);
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

### 5.1 gRPC Server（接收 Runner 连接）

由于 Runner 可能部署在 NAT 后面，Server 需要作为 gRPC Server 监听，Runner 主动连接。

```typescript
// src/grpc/server.ts

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';
import { RunnerService } from '../services/runner.service';
import { SandboxService } from '../services/sandbox.service';
import { EventBus } from '../events/event-bus';

const RUNNER_PROTO_PATH = path.join(__dirname, '../../proto/runner/runner.proto');

const packageDefinition = protoLoader.loadSync(RUNNER_PROTO_PATH, {
  keepCase: true,  // 保持原始命名
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const runnerProto = grpc.loadPackageDefinition(packageDefinition).runner as any;

export class GrpcServer {
  private server: grpc.Server | null = null;
  private runnerConnections: Map<string, any> = new Map();

  constructor(private port: number = 50051) {}

  /**
   * 启动 gRPC Server
   */
  async start(): Promise<void> {
    this.server = new grpc.Server({
      'grpc.max_receive_message_length': 50 * 1024 * 1024,  // 50MB
      'grpc.max_send_message_length': 50 * 1024 * 1024,
    });

    // 添加服务实现
    this.server.addService(runnerProto.RunnerService.service, {
      Register: this.handleRegister.bind(this),
      Heartbeat: this.handleHeartbeat.bind(this),
      ReportStatus: this.handleReportStatus.bind(this),
      UploadLogs: this.handleUploadLogs.bind(this),
    });

    return new Promise((resolve, reject) => {
      this.server!.bindAsync(
        `0.0.0.0:${this.port}`,
        grpc.ServerCredentials.createInsecure(),
        (error, port) => {
          if (error) {
            reject(error);
          } else {
            console.log(`gRPC Server listening on port ${port}`);
            resolve();
          }
        }
      );
    });
  }

  /**
   * 处理 Runner 注册
   */
  private async handleRegister(
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>
  ): Promise<void> {
    try {
      const request = call.request;
      const { runnerId, name, address, capacity, resources, region, metadata } = request;

      // 验证注册信息
      if (!runnerId || !name) {
        callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'Missing required fields: runnerId, name',
        });
        return;
      }

      // 保存连接
      this.runnerConnections.set(runnerId, {
        address,
        lastHeartbeat: new Date(),
        stream: null as any,
      });

      // 更新 Runner 状态
      await RunnerService.updateRunner(runnerId, {
        status: 'online',
        address,
        capacity,
        resources,
        region,
        metadata,
        lastHeartbeat: new Date(),
      });

      // 发送注册响应
      callback(null, {
        success: true,
        serverVersion: '1.0.0',
        config: {
          heartbeatInterval: 30000,  // 30秒
          statusReportInterval: 60000,  // 60秒
          maxConcurrentJobs: capacity.available,
        },
      });

      console.log(`Runner registered: ${name} (${runnerId})`);
    } catch (error) {
      console.error('Register error:', error);
      callback({
        code: grpc.status.INTERNAL,
        message: 'Registration failed',
      });
    }
  }

  /**
   * 处理心跳
   */
  private async handleHeartbeat(
    call: grpc.ServerReadableStream<any, any>
  ): Promise<void> {
    const runnerId = call.request?.runnerId;

    call.on('data', async (heartbeat) => {
      this.runnerConnections.set(runnerId, {
        ...this.runnerConnections.get(runnerId),
        lastHeartbeat: new Date(),
      });

      await RunnerService.updateRunner(runnerId, {
        status: 'online',
        lastHeartbeat: new Date(),
        resources: heartbeat.resources,
      });
    });

    call.on('error', (error) => {
      console.error(`Heartbeat error from ${runnerId}:`, error);
      this.handleRunnerDisconnect(runnerId);
    });

    call.on('end', () => {
      this.handleRunnerDisconnect(runnerId);
    });
  }

  /**
   * 处理状态上报
   */
  private async handleReportStatus(
    call: grpc.ServerReadableStream<any, any>
  ): Promise<void> {
    const runnerId = call.request?.runnerId;

    call.on('data', async (report) => {
      const { sandboxId, status, metrics, error } = report;

      // 更新 Sandbox 状态
      await SandboxService.updateStatusFromRunner(runnerId, sandboxId, status, metrics);

      // 发布事件
      if (status === 'running') {
        await EventBus.publish('sandbox.started', { sandboxId, runnerId });
      } else if (status === 'failed') {
        await EventBus.publish('sandbox.failed', { sandboxId, runnerId, error });
      }
    });

    call.on('error', (error) => {
      console.error(`Status report error from ${runnerId}:`, error);
    });
  }

  /**
   * 处理日志上传
   */
  private async handleUploadLogs(
    call: grpc.ServerReadableStream<any, any>
  ): Promise<void> {
    const chunks: Buffer[] = [];

    call.on('data', (chunk) => {
      chunks.push(Buffer.from(chunk.data, 'base64'));
    });

    call.on('end', async () => {
      const logData = Buffer.concat(chunks).toString();
      console.log('Received logs:', logData.substring(0, 500));  // 只打印前500字符
    });
  }

  /**
   * 处理 Runner 断开连接
   */
  private async handleRunnerDisconnect(runnerId: string): Promise<void> {
    this.runnerConnections.delete(runnerId);

    await RunnerService.updateRunner(runnerId, {
      status: 'offline',
    });

    console.log(`Runner disconnected: ${runnerId}`);
  }

  /**
   * 停止 Server
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.tryShutdown(() => {
          console.log('gRPC Server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * 获取活跃连接数
   */
  getActiveConnections(): number {
    return this.runnerConnections.size;
  }
}

export const grpcServer = new GrpcServer();
```

### 5.2 gRPC 客户端（用于发送控制命令）

```typescript
// src/grpc/client.ts

import * as grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import path from 'path';

const RUNNER_PROTO_PATH = path.join(__dirname, '../../proto/runner/runner.proto');

const packageDefinition = protoLoader.loadSync(RUNNER_PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const runnerProto = grpc.loadPackageDefinition(packageDefinition).runner as any;

export class GrpcClient {
  private clients: Map<string, any> = new Map();

  /**
   * 提交 Job 到 Runner
   */
  async submitJob(params: {
    runnerId: string;
    jobId: string;
    type: string;
    payload: Record<string, any>;
    priority: number;
  }): Promise<any> {
    const client = await this.getClient(params.runnerId);

    return new Promise((resolve, reject) => {
      client.SubmitJob(
        {
          jobId: params.jobId,
          runnerId: params.runnerId,
          type: params.type,
          payload: JSON.stringify(params.payload),
          priority: params.priority,
        },
        (error: any, response: any) => {
          if (error) reject(error);
          else resolve(response);
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
    const client = await this.getClient(runnerId);

    return new Promise((resolve, reject) => {
      client.SendControlCommand({ sandboxId, command }, (error: any) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  private async getClient(runnerId: string): Promise<any> {
    if (this.clients.has(runnerId)) {
      return this.clients.get(runnerId);
    }

    // 从数据库获取 Runner 地址
    const { prisma } = await import('../database/client');
    const runner = await prisma.runner.findUnique({
      where: { id: runnerId },
    });

    if (!runner) {
      throw new Error(`Runner not found: ${runnerId}`);
    }

    const client = new runnerProto.RunnerService(
      runner.address,
      grpc.credentials.createInsecure()
    );

    this.clients.set(runnerId, client);
    return client;
  }
}

export const grpcClient = new GrpcClient();
```

### 5.3 Runner 服务

```typescript
// src/services/runner.service.ts

import { prisma } from '../database/client';

export class RunnerService {
  /**
   * 更新 Runner 信息
   */
  static async updateRunner(runnerId: string, data: {
    status?: string;
    address?: string;
    capacity?: any;
    resources?: any;
    region?: string;
    metadata?: any;
    lastHeartbeat?: Date;
  }): Promise<void> {
    await prisma.runner.update({
      where: { id: runnerId },
      data: {
        ...data,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * 获取 Runner 列表
   */
  static async listRunners(filters?: {
    status?: string;
    region?: string;
  }): Promise<any[]> {
    return prisma.runner.findMany({
      where: filters,
      orderBy: { lastHeartbeat: 'desc' },
    });
  }

  /**
   * 获取 Runner 详情
   */
  static async getRunner(runnerId: string): Promise<any> {
    return prisma.runner.findUnique({
      where: { id: runnerId },
      include: {
        sandboxes: {
          where: { status: { in: ['pending', 'running'] } },
          take: 10,
        },
      },
    });
  }

  /**
   * 更新 Runner 容量
   */
  static async updateCapacity(runnerId: string, sandboxCount: number): Promise<void> {
    const runner = await prisma.runner.findUnique({
      where: { id: runnerId },
    });

    if (!runner) return;

    const capacity = JSON.parse(runner.capacity);
    const available = Math.max(0, capacity.total - sandboxCount);

    await prisma.runner.update({
      where: { id: runnerId },
      data: {
        capacity: JSON.stringify({ ...capacity, available }),
      },
    });
  }
}
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

### 7.1 内存队列实现

```typescript
// src/workers/queue.ts

import { EventEmitter } from 'events';

interface QueueJob {
  id: string;
  type: string;
  payload: any;
  priority: number;
  retryCount: number;
  maxRetries: number;
  createdAt: Date;
  scheduledAt?: Date;
}

type JobHandler = (job: QueueJob) => Promise<void>;

export class JobQueue extends EventEmitter {
  private queue: QueueJob[] = [];
  private processing: Set<string> = new Set();
  private handlers: Map<string, JobHandler> = new Map();
  private isRunning: boolean = false;
  private workerCount: number;
  private workers: Worker[] = [];

  constructor(workerCount: number = 5) {
    super();
    this.workerCount = workerCount;
  }

  /**
   * 启动队列
   */
  async start(): Promise<void> {
    this.isRunning = true;

    for (let i = 0; i < this.workerCount; i++) {
      const worker = new Worker(this, `queue-worker-${i}`);
      this.workers.push(worker);
      await worker.start();
    }

    console.log(`JobQueue started with ${this.workerCount} workers`);
  }

  /**
   * 停止队列
   */
  async stop(): Promise<void> {
    this.isRunning = false;

    for (const worker of this.workers) {
      await worker.stop();
    }
    this.workers = [];
    this.processing.clear();

    console.log('JobQueue stopped');
  }

  /**
   * 注册处理器
   */
  registerHandler(type: string, handler: JobHandler): void {
    this.handlers.set(type, handler);
  }

  /**
   * 添加任务
   */
  async enqueue(type: string, payload: any, options: {
    priority?: number;
    maxRetries?: number;
    delay?: number;
  } = {}): Promise<string> {
    const job: QueueJob = {
      id: `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      payload,
      priority: options.priority ?? 0,
      retryCount: 0,
      maxRetries: options.maxRetries ?? 3,
      createdAt: new Date(),
      scheduledAt: options.delay ? new Date(Date.now() + options.delay) : undefined,
    };

    this.queue.push(job);
    this.queue.sort((a, b) => {
      // 优先处理有 scheduledAt 的
      if (a.scheduledAt && !b.scheduledAt) return 1;
      if (!a.scheduledAt && b.scheduledAt) return -1;
      if (a.scheduledAt && b.scheduledAt) {
        return a.scheduledAt.getTime() - b.scheduledAt.getTime();
      }
      // 按优先级降序
      return b.priority - a.priority;
    });

    this.emit('enqueued', job);
    return job.id;
  }

  /**
   * 获取任务
   */
  async dequeue(): Promise<QueueJob | null> {
    const now = new Date();

    // 查找可执行的任务
    const index = this.queue.findIndex(job =>
      !this.processing.has(job.id) &&
      (!job.scheduledAt || job.scheduledAt <= now)
    );

    if (index === -1) {
      return null;
    }

    const [job] = this.queue.splice(index, 1);
    this.processing.add(job.id);

    return job;
  }

  /**
   * 完成任务
   */
  async complete(job: QueueJob): Promise<void> {
    this.processing.delete(job.id);
    this.emit('completed', job);
  }

  /**
   * 失败任务重试
   */
  async fail(job: QueueJob, error: Error): Promise<void> {
    this.processing.delete(job.id);

    if (job.retryCount < job.maxRetries) {
      job.retryCount++;
      // 指数退避
      const delay = Math.pow(2, job.retryCount) * 1000;
      job.scheduledAt = new Date(Date.now() + delay);
      this.queue.push(job);
      this.emit('retried', job, error);
    } else {
      this.emit('failed', job, error);
    }
  }

  /**
   * 获取队列状态
   */
  getStatus(): { queued: number; processing: number; workers: number } {
    return {
      queued: this.queue.length,
      processing: this.processing.size,
      workers: this.workers.length,
    };
  }
}

class Worker {
  private isProcessing: boolean = false;

  constructor(
    private queue: JobQueue,
    private name: string
  ) {}

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
        const job = await this.queue.dequeue();
        if (job) {
          await this.processJob(job);
        } else {
          await this.sleep(1000);  // 空闲等待
        }
      } catch (error) {
        console.error(`[${this.name}] Error:`, error);
        await this.sleep(5000);
      }
    }
  }

  private async processJob(job: QueueJob): Promise<void> {
    console.log(`[${this.name}] Processing job: ${job.id} (${job.type})`);

    try {
      const handler = this.queue['handlers'].get(job.type);
      if (!handler) {
        throw new Error(`No handler for job type: ${job.type}`);
      }

      await handler(job);
      await this.queue.complete(job);

      console.log(`[${this.name}] Job completed: ${job.id}`);
    } catch (error) {
      console.error(`[${this.name}] Job failed: ${job.id}`, error);
      await this.queue.fail(job, error as Error);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// 全局队列实例
export const jobQueue = new JobQueue(5);
```

### 7.2 预注册任务处理器

```typescript
// src/workers/handlers.ts

import { jobQueue } from './queue';
import { prisma } from '../database/client';
import { SandboxService } from '../services/sandbox.service';

// 注册 Sandbox 清理任务
jobQueue.registerHandler('DELETE_ARCHIVED', async (job) => {
  const { sandboxId, gracePeriod } = job.payload;

  // 再次检查是否还在使用
  const sandbox = await prisma.sandbox.findUnique({
    where: { id: sandboxId },
  });

  if (!sandbox || sandbox.status === 'deleted') {
    return;  // 已经被删除
  }

  await SandboxService.forceDeleteSandbox(sandboxId);
  console.log(`Archived sandbox deleted: ${sandboxId}`);
});

// 注册孤立资源清理任务
jobQueue.registerHandler('CLEANUP_ORPHANS', async (job) => {
  // 查找状态异常超过阈值的 Sandbox
  const orphaned = await prisma.sandbox.findMany({
    where: {
      status: { in: ['pending', 'running'] },
      updatedAt: {
        lt: new Date(Date.now() - 30 * 60 * 1000),  // 30分钟未更新
      },
    },
  });

  for (const sandbox of orphaned) {
    try {
      // 尝试从 Runner 获取真实状态
      if (sandbox.runnerId) {
        // TODO: 通过 gRPC 获取真实状态
      }

      // 如果无法确认，标记为可疑
      await pr({
        where:isma.sandbox.update { id: sandbox.id },
        data: { status: 'suspected_orphaned' },
      });
    } catch (error) {
      console.error(`Cleanup error for ${sandbox.id}:`, error);
    }
  }
});

// 注册指标收集任务
jobQueue.registerHandler('COLLECT_METRICS', async (job) => {
  const { sandboxId } = job.payload;

  const sandbox = await prisma.sandbox.findUnique({
    where: { id: sandboxId },
  });

  if (!sandbox || sandbox.status !== 'running') {
    return;
  }

  // 从 Runner 获取指标
  try {
    const metrics = await SandboxService.getSandboxMetrics(sandbox.runnerId, sandboxId);

    // 存储到历史记录
    await prisma.metricHistory.create({
      data: {
        sandboxId,
        cpuUsage: metrics.cpuUsage,
        memoryUsage: metrics.memoryUsage,
        diskUsage: metrics.diskUsage,
        networkIn: metrics.networkIn,
        networkOut: metrics.networkOut,
      },
    });

    // 更新当前指标
    await prisma.sandbox.update({
      where: { id: sandboxId },
      data: { metrics: JSON.stringify(metrics) },
    });
  } catch (error) {
    console.error(`Failed to collect metrics for ${sandboxId}:`, error);
  }
});

// 启动队列
export async function startJobQueue(): Promise<void> {
  await jobQueue.start();

  // 定时清理归档的 Sandbox
  setInterval(async () => {
    const archived = await prisma.sandbox.findMany({
      where: {
        status: 'archived',
        archivedAt: { lt: new Date() },
      },
      take: 100,
    });

    for (const sandbox of archived) {
      await jobQueue.enqueue('DELETE_ARCHIVED', {
        sandboxId: sandbox.id,
        gracePeriod: 0,
      });
    }
  }, 60000);  // 每分钟检查一次
}
```

### 7.3 任务调度示例

```typescript
// 安排延迟删除
await jobQueue.enqueue('DELETE_ARCHIVED', {
  sandboxId: 'xxx',
  gracePeriod: 3600,
}, {
  priority: 10,  // 高优先级
});

// 安排指标收集
await jobQueue.enqueue('COLLECT_METRICS', {
  sandboxId: 'xxx',
}, {
  priority: -10,  // 低优先级
  delay: 300000,  // 5秒后执行
});
```

---

## 8. 数据库模型

### 8.1 数据库选择

Server 支持 **SQLite**（默认）和 **PostgreSQL** 两种数据库。

```bash
# 默认使用 SQLite
DATABASE_URL="file:./data/codepod.db"

# 切换到 PostgreSQL
DATABASE_URL="postgresql://user:pass@localhost:5432/codepod"
```

| 特性 | SQLite | PostgreSQL |
|------|--------|------------|
| 部署复杂度 | 低（单文件） | 高（需单独服务） |
| 并发性能 | 中等 | 高 |
| 适用场景 | 开发/单机部署 | 生产/分布式部署 |
| 备份 | 复制文件即可 | pg_dump |

### 8.2 用户模型

```prisma
// User 用户模型
model User {
  id          String    @id @default(uuid())
  email       String    @unique
  name        String
  role        String    @default("user")  // user, admin
  status      String    @default("active")  // active, disabled
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  apiKeys     ApiKey[]
  sandboxes   Sandbox[]
  quotas      Quota?
  webhooks    Webhook[]
  auditLogs   AuditLog[]

  @@index([email])
}
```

### 8.3 Prisma Schema（完整）

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"  // 默认使用 SQLite，改为 postgresql 即切换到 PostgreSQL
  url      = env("DATABASE_URL")
}

// 用户
model User {
  id          String    @id @default(uuid())
  email       String    @unique
  name        String
  role        String    @default("user")
  status      String    @default("active")
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  apiKeys     ApiKey[]
  sandboxes   Sandbox[]
  quotas      Quota?
  webhooks    Webhook[]
  auditLogs   AuditLog[]

  @@index([email])
}

// 用户 API Keys
model ApiKey {
  id          String    @id @default(uuid())
  keyHash     String    @unique
  name        String
  userId      String
  permissions String    @default("[]")
  status      String    @default("active")
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  lastUsedAt  DateTime?
  expiresAt   DateTime?

  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

// Sandbox 实例
model Sandbox {
  id            String    @id @default(uuid())
  name          String
  userId        String
  apiKeyId      String
  runnerId      String?
  image         String
  imageVersion  String    @default("latest")
  status        String    @default("pending")
  resources     String    @default("{}")
  env           String?
  sshToken      String?
  timeout       Int       @default(3600)
  annotations   String?
  exposedPorts  String    @default("[]")
  metrics       String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  startedAt     DateTime?
  stoppedAt     DateTime?
  archivedAt    DateTime?
  deletedAt     DateTime?

  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  snapshots     Snapshot[]
  metricsHistory MetricHistory[]

  @@index([userId])
  @@index([runnerId])
  @@index([status])
}

// 快照
model Snapshot {
  id           String    @id @default(uuid())
  sandboxId    String
  name         String
  description  String?
  size         String    @default("0")
  status       String    @default("creating")  // creating, ready, failed
  backupPath   String?
  createdAt    DateTime  @default(now())
  deletedAt    DateTime?

  sandbox      Sandbox   @relation(fields: [sandboxId], references: [id], onDelete: Cascade)

  @@index([sandboxId])
}

// 指标历史
model MetricHistory {
  id          String    @id @default(uuid())
  sandboxId   String
  cpuUsage    Float?
  memoryUsage Float?
  diskUsage   String?
  networkIn   Int?
  networkOut  Int?
  collectedAt DateTime  @default(now())

  sandbox     Sandbox   @relation(fields: [sandboxId], references: [id], onDelete: Cascade)

  @@index([sandboxId])
  @@index([collectedAt])
}

// Runner 注册表
model Runner {
  id           String    @id @default(uuid())
  name         String
  address      String    @unique
  status       String    @default("offline")
  capacity     String    @default("{}")
  resources    String    @default("{}")
  region       String?
  metadata     String?
  lastHeartbeat DateTime  @default(now())
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  sandboxes    Sandbox[]

  @@index([status])
  @@index([region])
}

// 用户配额
model Quota {
  userId        String   @id
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  maxSandboxes  Int      @default(10)
  maxCpu        Int      @default(100)
  maxMemory     String   @default("100Gi")
  maxDisk       String   @default("1Ti")
  maxSnapshots  Int      @default(50)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

// Webhook 配置
model Webhook {
  id          String    @id @default(uuid())
  name        String
  url         String
  secret      String?
  events      String    @default("[]")
  status      String    @default("active")
  sandboxId   String?
  userId      String
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([sandboxId])
  @@index([userId])
}

// Webhook 发送记录
model WebhookLog {
  id          String   @id @default(uuid())
  webhookId   String
  event       String
  payload     String
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
  details      String?
  ipAddress    String
  userAgent    String
  createdAt    DateTime @default(now())

  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([resourceType])
  @@index([createdAt])
}

// 系统配置
model Config {
  id        String   @id @default(uuid())
  key       String   @unique
  value     String
  updatedAt DateTime @updatedAt
}

### 8.3 数据库客户端封装

```typescript
// src/database/client.ts

import { PrismaClient } from '@prisma/client';

// 单例 Prisma 客户端
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

// SQLite 特定优化
export function enableWalMode(): void {
  if (process.env.DATABASE_URL?.includes('file:')) {
    // 启用 WAL 模式提升并发性能
    prisma.$queryRaw`PRAGMA journal_mode=WAL`.catch(() => {});
  }
}

// 初始化数据库
export async function initializeDatabase(): Promise<void> {
  await prisma.$connect();
  await enableWalMode();
  console.log('Database connected');
}

// 关闭连接
export async function closeDatabase(): Promise<void> {
  await prisma.$disconnect();
}
```

### 8.4 SQLite 迁移脚本

```bash
# 生成并应用迁移
npx prisma migrate dev --name init

# 生产环境部署
npx prisma migrate deploy

# 从 SQLite 切换到 PostgreSQL
# 1. 修改 DATABASE_URL
# 2. 修改 schema.prisma provider = "postgresql"
# 3. 执行迁移
npx prisma migrate dev --name switch_to_postgres
```

### 8.5 数据备份

```bash
# SQLite 备份（复制文件）
cp data/codepod.db data/codepod_backup.db

# 压缩备份
sqlite3 data/codepod.db .dump | gzip > backup_$(date +%Y%m%d).sql.gz

# 定时备份脚本
#!/bin/bash
BACKUP_DIR="/backup/codepod"
DATE=$(date +%Y%m%d_%H%M%S)
cp "$BACKUP_DIR/codepod.db" "$BACKUP_DIR/codepod_${DATE}.db"
```

---

## 9. 部署配置

### 9.1 Dockerfile

```dockerfile
# apps/server/Dockerfile

FROM node:20-alpine

WORKDIR /app

# 创建数据目录
RUN mkdir -p /app/data && chown -R nodejs:nodejs /app

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
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 3000

# 使用 volume 挂载数据目录
VOLUME ["/app/data"]

CMD ["node", "dist/index.js"]
```

### 9.2 Docker Compose 开发配置

```yaml
# apps/server/docker-compose.yml

version: '3.8'

services:
  server:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data  # SQLite 数据文件
      - ./logs:/app/logs
    environment:
      - NODE_ENV=development
      - DATABASE_URL=file:./data/codepod.db
      - LOG_LEVEL=debug
      - GRPC_PORT=50051
    restart: unless-stopped

  # 可选：Redis（生产环境建议使用）
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    restart: unless-stopped

volumes:
  redis-data:
```

### 9.3 package.json 依赖配置

```json
{
  "name": "@codepod/server",
  "version": "0.1.0",
  "description": "CodePod Server - Control Plane",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "ts-node src/index.ts",
    "start": "node dist/index.js",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:studio": "prisma studio",
    "test": "jest"
  },
  "dependencies": {
    "@prisma/client": "^5.10.0",
    "better-sqlite3": "^9.4.0",
    "express": "^4.18.2",
    "@grpc/grpc-js": "^1.9.14",
    "@grpc/proto-loader": "^0.7.10",
    "uuid": "^9.0.0",
    "prom-client": "^15.1.0",
    "winston": "^3.11.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.11.0",
    "@types/uuid": "^9.0.8",
    "typescript": "^5.3.0",
    "ts-node": "^10.9.2",
    "jest": "^29.7.0",
    "@types/jest": "^29.5.11",
    "prisma": "^5.10.0"
  }
}
```

### 9.2 环境变量

```bash
# apps/server/.env.example

# 服务配置
NODE_ENV=production
PORT=3000
LOG_LEVEL=info

# 数据库（SQLite 默认）
DATABASE_URL="file:./data/codepod.db"
# PostgreSQL（可选）
# DATABASE_URL="postgresql://user:pass@localhost:5432/codepod"

# Redis（可选，用于会话缓存）
REDIS_URL=redis://localhost:6379

# 消息队列（可选，用于异步任务）
# RABBITMQ_URL=amqp://localhost:5672

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

### 9.4 日志持久化

```typescript
// src/utils/logger.ts

import winston from 'winston';
import path from 'path';

const LOG_DIR = process.env.LOG_DIR || './logs';

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
    return `${timestamp} [${level.toUpperCase()}]: ${message} ${metaStr}`;
  })
);

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports: [
    // 控制台输出
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        logFormat
      ),
    }),

    // 文件输出 - 错误日志
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024,  // 10MB
      maxFiles: 5,
    }),

    // 文件输出 - 所有日志
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'combined.log'),
      maxsize: 10 * 1024 * 1024,
      maxFiles: 10,
    }),

    // 文件输出 - 访问日志
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'access.log'),
      maxsize: 10 * 1024 * 1024,
      maxFiles: 10,
    }),
  ],
});

// 访问日志中间件
export function accessLogger(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('HTTP Access', {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      userAgent: req.get('user-agent'),
      ip: req.ip,
    });
  });

  next();
}
```

### 9.5 日志轮转配置

```bash
# logrotate 配置
# /etc/logrotate.d/codepod

/var/log/codepod/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 www-data www-data
    sharedscripts
    postrotate
        systemctl reload codepod-server > /dev/null 2>&1 || true
    endscript
}
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
├── package.json                    # 依赖配置
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
