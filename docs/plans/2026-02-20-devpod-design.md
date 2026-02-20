# DevPod 设计文档

**版本**: v1.2
**日期**: 2026-02-20

## 1. 概述

DevPod 是基于 CodePod Sandbox 的开发容器环境管理工具，提供一致的开发体验，屏蔽底层容器环境的差异。

### 1.1 核心目标

- **环境一致性**: 无论容器运行在哪个 Runner，开发体验一致
- **即开即用**: 快速创建开发环境，支持多种语言运行时
- **透明转发**: 端口转发、文件同步等对用户透明
- **Git 集成**: 直接从代码仓库构建开发环境
- **IDE 集成**: 支持 VS Code Remote
- **无 Docker 构建**: 通过 builder 镜像在 sandbox 内构建镜像，无需本地 Docker

## 2. 核心概念

### 2.1 Workspace

Workspace 是开发环境的核心单元，关联以下资源：

| 资源 | 数量 | 说明 |
|------|------|------|
| Dev Sandbox | 1 个 | 开发者实际使用的运行时环境 |
| Builder Sandbox | 1 个（临时） | 镜像构建环境，构建完成后销毁 |
| 共享卷 | 1 个 | 代码存储，构建和开发共用，生命周期跟随 workspace |
| Git 仓库 | 0 或 1 个 | 源代码仓库，首次构建时克隆到共享卷 |
| IDE | 1 个 | VS Code Remote |

### 2.2 Volume API 扩展

需要扩展 CodePod API 支持卷管理：

```typescript
// 创建卷
POST /api/v1/volumes
Body: {
  name: string;
  size: string;        // e.g., "10Gi"
}
Response: { volumeId: string; hostPath: string }

// 删除卷
DELETE /api/v1/volumes/:id

// 挂载卷到 Sandbox
POST /api/v1/sandboxes
Body: {
  image: string;
  volumes: [{
    volumeId: string;
    mountPath: string;
  }];
}
```

### 2.3 卷存储后端

**单机 Runner (本地存储)**:
- 使用 Docker volume 或 hostPath
- 路径: `/var/lib/docker/volumes/{volumeId}/_data`
- 同一 Runner 上的 Sandbox 可共享访问

**多机 Runner (待扩展)**:
- 使用 NFS、CephFS 等网络存储
- 或分布式文件系统

### 2.4 Workspace 配置存储

- **`.devpod.json`**: `~/.devpod/` 目录（用户级配置）
- **Workspace 列表**: `~/.devpod/workspaces/` (JSON 文件)
- **构建日志**: `~/.devpod/logs/`

### 2.5 Builder 镜像

Builder 镜像是 DevPod 的核心创新：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Builder Sandbox                                      │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  Builder 镜像 (Go 实现)                                                │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │  │  envbuilder (Go 进程)                                           │  │  │
│  │  │  - 支持 Dockerfile 构建                                         │  │  │
│  │  │  - 支持 devcontainer.json 配置                                  │  │  │
│  │  │  - 调用 Docker 构建镜像                                         │  │  │
│  │  │  - 推送到内置镜像仓库                                            │  │  │
│  │  └─────────────────────────────────────────────────────────────────┘  │  │
│  │                                                                       │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │  │  支持的工具                                                       │  │  │
│  │  │  - git: 克隆代码到共享卷                                         │  │  │
│  │  │  - docker: 镜像构建                                             │  │  │
│  │  │  - go, node, python: 多语言支持                                  │  │  │
│  │  │  - skopeo: 镜像推送                                             │  │  │
│  │  └─────────────────────────────────────────────────────────────────┘  │  │
│  │                                                                       │  │
│  │  共享卷: /workspace (代码存储，构建完成后保留)                         │  │
│  │  Docker: /var/run/docker.sock (镜像构建)                             │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

**为什么需要 Docker in Docker**:
- Builder Sandbox 内部运行 Docker daemon
- 用于构建容器镜像和推送到内置仓库
- 使用 `--privileged` 权限运行

### 2.6 Workspace 创建流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          devpod up 命令                                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌───────────────────────────────────────┐
│  阶段 1: 解析配置                     │
│  - 读取命令行参数 (--repo)            │
└───────────────────────────────────────┘
                                      │
                                      ▼
┌───────────────────────────────────────┐
│  阶段 2: 创建共享卷                   │
│  - 调用 CodePod API 创建 volume       │
└───────────────────────────────────────┘
                                      │
                                      ▼
┌───────────────────────────────────────┐
│  阶段 3: 发放 Builder Sandbox        │
│  - 调用 CodePod API 创建 sandbox      │
│  - 使用 builder 镜像                 │
│  - 挂载共享卷                        │
└───────────────────────────────────────┘
                                      │
                                      ▼
┌───────────────────────────────────────┐
│  阶段 4: 构建镜像 (在 Builder 中)     │
│  a. Clone Git 仓库到共享卷           │
│  b. 执行 Dockerfile 构建              │
│  c. 推送到内置镜像仓库              │
└───────────────────────────────────────┘
                                      │
                                      ▼
┌───────────────────────────────────────┐
│  阶段 5: 销毁 Builder Sandbox        │
│  - 释放构建资源                       │
│  - 保留共享卷                        │
└───────────────────────────────────────┘
                                      │
                                      ▼
┌───────────────────────────────────────┐
│  阶段 6: 发放 Dev Sandbox + 启动 IDE │
│  - 创建 Dev Sandbox                  │
│  - 挂载共享卷                        │
│  - 拉取镜像                          │
│  - 自动打开 VS Code Remote           │
└───────────────────────────────────────┘
```

## 3. 系统架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DevPod CLI                                      │
│  apps/devpod/                                                                │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  Workspace Manager                                                  │    │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────────┐  │    │
│  │  │ Git Service │ │Builder Manager│ │ Registry Service           │  │    │
│  │  │ - Clone     │ │- SSH 执行    │ │ - Push/Pull Images         │  │    │
│  │  │ - Sync      │ │- 日志流      │ │ - 内置仓库                 │  │    │
│  │  └─────────────┘ └─────────────┘ └─────────────────────────────┘  │    │
│  │                                                                      │    │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────────┐  │    │
│  │  │ Sandbox Mgr │ │ VS Code     │ │ Port/File Services         │  │    │
│  │  │ - Create    │ │ - Remote    │ │ - Port Forward             │  │    │
│  │  │ - Manage    │ │             │ │ - File Sync                │  │    │
│  │  └─────────────┘ └─────────────┘ └─────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ REST API
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          CodePod Server                                      │
│  - Sandbox 生命周期管理                                                      │
│  - 内置镜像仓库 (集成)                                                       │
│  - API Key 认证                                                              │
│  - gRPC 与 Runner 通信                                                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                   ┌──────────────────┴──────────────────┐
                   │                                      │
                   ▼                                      ▼
┌─────────────────────────┐              ┌───────────────────────────────┐
│  Runner Pool            │              │  内置镜像仓库                 │
│  - 容器编排              │              │  - Docker Registry (集成)     │
│  - Builder Sandbox      │              │  - Workspace 镜像存储         │
│  - Dev Sandbox          │              │  - 拉取认证                   │
└─────────────────────────┘              └───────────────────────────────┘
                   │
         ┌─────────┴─────────┐
         │                   │
         ▼                   ▼
┌─────────────────┐  ┌─────────────────┐
│ Builder Sandbox │  │ Dev Sandbox    │
│                 │  │                 │
│ envbuilder      │  │ 开发环境        │
│ - 构建镜像      │  │ - SSH Server   │
│ - 推送镜像      │  │ - 共享卷代码    │
│ - 共享卷代码    │  │                 │
└─────────────────┘  └─────────────────┘
```

## 4. Builder 镜像实现

### 4.1 envbuilder 是什么

envbuilder 是 Coder 开源的容器镜像构建工具（Go 实现）：
- GitHub: https://github.com/coder/envbuilder
- 完整支持 devcontainer.json 规范：
  - `image`: 使用预制镜像
  - `dockerfile`: Dockerfile 构建
  - `features`: 开发工具特性（git, docker-in-docker, kubectl 等）
  - `customizations`: IDE 扩展和设置
  - `postCreateCommand`: 构建后执行命令
  - `remoteUser`: 指定运行用户
- 调用 Docker 构建镜像
- 推送到内置镜像仓库

### 4.2 Builder 镜像构建

```dockerfile
# builder.Dockerfile
FROM golang:1.21-alpine AS builder

# 克隆 envbuilder
RUN git clone https://github.com/coder/envbuilder.git && \
    cd envbuilder && \
    go build -o /usr/local/bin/envbuilder ./cmd/envbuilder

# 最终镜像
FROM ubuntu:22.04

# 安装依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    skopeo \
    docker.io \
    && rm -rf /var/lib/apt/lists/*

# 启动 Docker daemon (用于镜像构建)
RUN mkdir -p /var/run/docker && \
    chmod 666 /var/run/docker

# 复制 envbuilder
COPY --from=builder /usr/local/bin/envbuilder /usr/local/bin/

# 设置工作目录
WORKDIR /workspace

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD ["/bin/bash", "-c", "pgrep envbuilder || exit 1"]

ENTRYPOINT ["/usr/local/bin/envbuilder"]
```

### 4.3 Builder 执行方式

Builder Sandbox 不需要实现 HTTP API，直接通过 SSH 执行 shell 命令：

```typescript
// DevPod CLI 通过 SSH 连接 Builder Sandbox
const ssh = await connectSSH(builderSandboxInfo);

// 执行构建命令
const stream = await ssh.exec(`envbuilder \
  --dockerfile /workspace/repo/.devcontainer/Dockerfile \
  --context /workspace/repo \
  --image-name ${imageName} \
  --push`);

// 实时读取日志流
for await (const line of stream) {
  console.log(line);
}
```

## 5. 目录结构

```
apps/devpod/
├── src/
│   ├── index.ts                      # CLI 入口
│   ├── config.ts                     # 配置管理
│   │
│   ├── api/
│   │   └── client.ts                 # CodePod API 客户端
│   │
│   ├── services/
│   │   ├── git.ts                   # Git 仓库操作（通过 builder SSH 执行）
│   │   ├── builder.ts               # Builder 管理（SSH 执行命令）
│   │   ├── registry.ts              # 镜像仓库服务（内置仓库）
│   │   ├── sandbox.ts               # Sandbox 管理
│   │   ├── ide/
│   │   │   └── vscode.ts            # VS Code Remote
│   │   ├── port-forward.ts          # 端口转发
│   │   └── file-sync.ts             # 文件同步
│   │
│   ├── workspace/
│   │   ├── manager.ts               # Workspace 管理器
│   │   └── config.ts               # Workspace 配置
│   │
│   ├── commands/
│   │   ├── up.ts                  # 构建镜像 + 打开 VS Code
│   │   ├── list.ts                 # 列出 workspace
│   │   ├── delete.ts              # 删除 workspace
│   │   ├── stop.ts                 # 停止 workspace
│   │   ├── start.ts               # 启动 workspace
│   │   └── logs.ts                # 查看构建日志
│   │
│   ├── types/
│   │   └── index.ts                 # 类型定义
│   │
│   └── utils/
│       ├── logger.ts                # 日志工具
│       └── template.ts              # 模板工具
│
├── builder/                         # Builder 镜像源码 (Go)
│   ├── main.go                     # envbuilder 主入口
│   ├── envbuilder/
│   │   └── runner.go               # envbuilder 核心逻辑
│   ├── git/
│   │   └── clone.go                # Git 克隆工具
│   ├── docker/
│   │   └── parser.go               # Dockerfile 解析
│   └── devcontainer/
│       └── parser.go               # devcontainer 解析
│
├── templates/                       # devcontainer 模板
│   ├── base/
│   │   ├── .devcontainer/
│   │   │   ├── Dockerfile
│   │   │   └── devcontainer.json
│   │   └── README.md
│   ├── python/
│   ├── nodejs/
│   ├── golang/
│   ├── java/
│   └── fullstack/
│
├── package.json
├── tsconfig.json
└── README.md
```

## 6. Workspace 配置

### 6.1 配置文件 `.devpod.json`

```json
{
  "$schema": "https://devpod.dev/schema/v1",
  "name": "my-workspace",
  "git": {
    "url": "https://github.com/example/project",
    "branch": "main"
  },
  "devcontainer": {
    "path": ".devcontainer",
    "customizations": {
      "vscode": {
        "extensions": ["ms-python.python"]
      }
    }
  },
  "builder": {
    "cpu": 4,
    "memory": "8Gi",
    "timeout": 1800
  },
  "sandbox": {
    "cpu": 4,
    "memory": "8Gi",
    "timeout": 3600
  }
}
```

## 7. 核心命令

```bash
# Workspace 管理
devpod up --repo https://github.com/org/repo    # 构建镜像 + 打开 VS Code
devpod list                                      # 列出 workspace
devpod delete my-workspace                       # 删除 workspace
devpod stop my-workspace                         # 停止 workspace
devpod start my-workspace                        # 启动 workspace (重新打开 VS Code)

# Builder 管理 (高级)
devpod logs <build-id>

# 配置
devpod config set endpoint <server-url>
```

## 8. 构建流程详解

### 8.1 克隆代码到共享卷

DevPod CLI 通过 SSH 连接到 Builder Sandbox，执行：

```bash
# 使用 shallow clone 加速
git clone --depth 1 --branch <branch> <repo-url> /workspace/repo
```

### 8.2 构建镜像

通过 SSH 执行 envbuilder 命令：

```bash
envbuilder \
  --dockerfile /workspace/repo/.devcontainer/Dockerfile \
  --context /workspace/repo \
  --image-name registry.codepod.io/workspace/abc123:latest \
  --push
```

日志实时回传给 CLI：

```
[Builder] Cloning repository...
[Builder] Building image...
[Builder] Step 1/5: FROM python:3.11-slim
[Builder] ...
[Builder] Pushing to localhost:5000...
[Builder] Build complete: localhost:5000/workspace/abc123:latest
```

## 9. 内置镜像仓库

### 9.1 镜像命名规范

```
localhost:5000/
  workspace/
    {workspace-id}/
      latest          # 最新构建
      {timestamp}    # 历史版本
```

### 9.2 内置仓库特性

- **存储位置**: 随 Runner 部署，或独立部署
- **认证**: Token 或 Basic Auth
- **API**: Docker Registry v2 API 兼容

### 9.3 镜像推送

```bash
# Builder 推送镜像
docker tag myimage localhost:5000/workspace/abc123:latest
docker push localhost:5000/workspace/abc123:latest

# 或使用 skopeo
skopeo copy oci:/path/to/image "docker://localhost:5000/workspace/abc123:latest"
```

## 10. 错误处理策略

### 10.1 错误分类

| 错误类型 | 示例 | 处理策略 |
|----------|------|----------|
| 网络错误 | 超时、连接失败、DNS 解析失败 | 自动重试（3次，指数退避） |
| Docker 构建错误 | Dockerfile 语法错误、指令不支持 | 快速失败，显示构建日志 |
| 镜像推送失败 | 网络超时、认证失败 | 自动重试（3次） |
| 权限错误 | 无操作权限、私有仓库拒绝 | 快速失败，提示权限问题 |
| 资源不足 | 内存不足、磁盘空间不足 | 快速失败，提示资源问题 |

### 10.2 重试策略

```typescript
interface RetryConfig {
  maxRetries: number;        // 默认 3 次
  initialDelayMs: number;    // 初始延迟 1000ms
  maxDelayMs: number;        // 最大延迟 30000ms
  backoffMultiplier: number;  // 退避系数 2.0
}

// 指数退避计算
delay = min(initialDelayMs * (2 ^ attempt), maxDelayMs) + random(0, 100)
```

### 10.3 错误恢复

```typescript
// 构建失败后的选项
interface BuildFailure {
  stage: 'clone' | 'parse' | 'build' | 'push';
  error: string;
  logs: string;
  recoverable: boolean;
  suggestion?: string;
}
```

## 11. Workspace 存储结构

```
~/.devpod/
├── workspaces/
│   ├── my-project.json    # Workspace 元数据
│   └── another-project.json
├── logs/
│   ├── my-project-20240101120000.log
│   └── my-project-20240101123000.log
└── config.json            # CLI 全局配置

# 项目目录
my-project/
├── .devpod.json           # Workspace 配置
├── .devcontainer/
│   ├── Dockerfile
│   └── devcontainer.json
└── src/
    └── ...
```

### 11.1 Workspace 元数据

```json
{
  "name": "my-workspace",
  "id": "abc123-def456",
  "createdAt": "2024-01-01T12:00:00Z",
  "status": "running",
  "devSandboxId": "sandbox-123",
  "builderSandboxId": "sandbox-456",
  "volumeId": "vol-789",
  "imageRef": "localhost:5000/workspace/abc123:latest",
  "configPath": "/path/to/project/.devpod.json"
}
```
