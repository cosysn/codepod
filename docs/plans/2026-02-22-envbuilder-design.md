# Envbuilder 设计文档

## 概述

Envbuilder 是一个运行在 sandbox 容器内的无 Docker 依赖镜像构建工具，使用 Go 语言开发，支持 DevContainer 规范。

## 核心特性

- **无守护进程构建**: 使用 Google Kaniko 在用户空间构建镜像
- **DevContainer 规范支持**: 完整支持 devcontainer.json 配置
- **Features 解析**: 支持官方 devcontainer features
- **生命周期钩子**: 按规范顺序执行钩子脚本
- **镜像推送**: 构建完成后推送到内置 Registry

## 架构

### TS SDK 集成

devpod 使用 TS SDK 与 sandbox 通信：

```typescript
import { Sandbox } from '@codepod/sdk-ts';

const sandbox = await Sandbox.create({
  baseURL: 'http://localhost:8080',
  apiKey: 'xxx',
  image: 'envbuilder:latest'
});

// 执行 envbuilder 构建命令
const result = await sandbox.commands.run('/app/envbuilder build ...', {
  onStdout: (data) => process.stdout.write(data.line),
  onStderr: (data) => process.stderr.write(data.line),
  timeout: 600000  // 10分钟超时
});

if (result.exitCode !== 0) {
  throw new Error('Build failed');
}
```

### 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        devpod (编排者)                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. 下载代码仓库 (git clone / pull)                             │
│  2. 读取仓库的 .devcontainer/ 目录                              │
│  3. 启动 envbuilder 容器                                        │
│  4. 指挥 envbuilder 构建镜像                                    │
│  5. 拉取构建好的镜像                                            │
│  6. 运行开发容器                                                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    envbuilder (构建者)                           │
├─────────────────────────────────────────────────────────────────┤
│  • 解析 devcontainer.json                                       │
│  • 解析 Features                                                │
│  • 执行 Kaniko 构建                                              │
│  • 推送镜像到 Registry                                          │
└─────────────────────────────────────────────────────────────────┘
```

### envbuilder 流水线

```
┌─────────────────────────────────────────────────────────────────┐
│                      envbuilder 流水线                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Phase 1: 构建阶段                                          │ │
│  │  1. 解析 devcontainer.json                                │ │
│  │  2. 解析 Features → 生成安装脚本                          │ │
│  │  3. 合并 Dockerfile (如有自定义)                         │ │
│  │  4. Kaniko 构建镜像                                       │ │
│  │  5. 推送到 Registry                                       │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              │                                   │
│                              ▼                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Phase 2: 生命周期钩子 (容器内执行)                          │ │
│  │  onCreateCommand        ─┐                               │ │
│  │  updateContentCommand   ─┼── 一次性钩子                  │ │
│  │  postCreateCommand      ─┤                               │ │
│  │                          ┘                                │ │
│  │  postStartCommand       ── 每次启动都运行                 │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 目录结构

```
apps/devpod/
├── envbuilder/              # envbuilder 主代码 (Go)
│   ├── cmd/
│   │   └── main.go        # 入口点
│   ├── pkg/
│   │   ├── config/        # devcontainer.json 解析
│   │   │   └── parser.go
│   │   ├── features/      # Features 解析器
│   │   │   └── resolver.go
│   │   ├── builder/       # Kaniko 封装
│   │   │   └── kaniko.go
│   │   ├── registry/      # 镜像推送
│   │   │   └── pusher.go
│   │   └── hooks/         # 生命周期钩子执行器
│   │       └── executor.go
│   ├── Dockerfile        # envbuilder 自身镜像
│   ├── go.mod
│   └── go.sum
└── ...
```

**注意**: envbuilder 读取的是**代码仓库**的 `.devcontainer/` 目录，而非自身的目录。

## 模块设计

### 1. Config Parser (pkg/config)

解析 `devcontainer.json` 的所有字段：
- `image` / `dockerFile`
- `features`
- `onCreateCommand`
- `updateContentCommand`
- `postCreateCommand`
- `postStartCommand`
- `workspaceFolder`
- `extensions`

### 2. Features Resolver (pkg/features)

支持官方 devcontainer features:
- 从 https://github.com/devcontainers/features 获取
- 生成对应的安装脚本
- 支持变量替换 `{{options}}`

### 3. Kaniko Builder (pkg/builder)

- 配置 kaniko 构建参数
- 设置 context 为项目目录
- 输出 OCI/Docker 镜像格式

### 4. Registry Pusher (pkg/registry)

- 推送到内置 Registry: `localhost:5000`
- 镜像命名: `codepod/sandbox-{sandboxId}:{timestamp}`

### 5. Hooks Executor (pkg/hooks)

按规范顺序执行钩子:

| 钩子 | 执行时机 | 典型用途 |
|------|----------|----------|
| onCreateCommand | 首次创建 | apt-get install |
| updateContentCommand | 源码挂载后 | npm install |
| postCreateCommand | 环境就绪后 | shell 配置 |
| postStartCommand | 每次启动 | 服务启动 |

## 输入输出

### 输入 (devpod 提供)

devpod 将代码仓库的 `.devcontainer/` 目录挂载到 envbuilder 容器:

```
/workspace/
├── .devcontainer/
│   ├── devcontainer.json    # 必需
│   ├── Dockerfile          # 可选
│   └── features/           # 可选 自定义 features
└── project/               # 项目源码 (挂载卷)
```

### 输出

- 镜像: `localhost:5000/codepod/sandbox-{sandboxId}:{timestamp}`
- 日志: 构建过程输出

## 构建镜像内容结构

```
镜像内容:
├── /workspace/           # 项目源码 (挂载卷)
├── /opt/codepod/        # envbuilder 工作目录
│   ├── hooks/           # 生命周期钩子脚本
│   └── entrypoint.sh    # 入口脚本 (处理 postStartCommand)
└── /usr/local/bin/      # 工具链
```

## 依赖

- Go 1.21+
- Kaniko (通过 Go 库 github.com/GoogleCloudPlatform/kariko)
- Docker/OCI 客户端库

## Registry 认证

当前内置 Registry (localhost:5000) 配置：
- 无认证（开放访问）
- 如需认证，可配置 htpasswd

Server 支持外部 Registry 认证类型：
- `basic`: 用户名/密码
- `bearer`: Token
- `aws-iam`: AWS IAM

envbuilder 推送镜像到内置 Registry 时，使用无认证方式。

## devpod 与 envbuilder 交互

### 通信方式
- 使用 **TS SDK** 与 sandbox 通信（gRPC）
- 通过 `sandbox.commands.run()` 执行命令
- 使用 **log stream** (gRPC streaming) 获取构建日志

### devpod 职责
1. 下载代码仓库
2. 提取 `.devcontainer/` 目录内容
3. 启动 envbuilder 容器（传递配置参数）
4. 通过 TS SDK 执行 envbuilder 命令
5. 通过 log stream 获取构建日志
6. 拉取构建好的镜像
7. 创建并运行开发容器

### envbuilder 职责
1. 接收构建参数（项目路径、目标镜像名等）
2. 解析 devcontainer.json
3. 解析 features
4. 执行 Kaniko 构建
5. 推送镜像到 Registry

### 构建上下文传递

devpod 需要传递给 envbuilder 的上下文：

| 上下文 | 说明 | 传递方式 |
|--------|------|----------|
| 项目源码 | `/workspace/project/` | 挂载卷 |
| .devcontainer/ | devcontainer.json, Dockerfile | 挂载到 `/workspace/.devcontainer/` |
| 构建参数 | 目标镜像名、Registry 地址 | 环境变量 |

```
envbuilder 容器内目录结构:
/workspace/
├── .devcontainer/        # 挂载：代码仓库的 .devcontainer/
│   ├── devcontainer.json
│   └── Dockerfile
└── project/             # 挂载：项目源码
```

### 生命周期钩子持久化

根据 DevContainer 规范：

| 钩子 | 执行时机 | 持久化方式 |
|------|----------|------------|
| onCreateCommand | 首次创建 | 构建时写入镜像 `RUN` 指令 |
| updateContentCommand | 源码挂载后 | 构建时写入镜像 `RUN` 指令 |
| postCreateCommand | 环境就绪后 | 构建时写入镜像 `RUN` 指令 |
| postStartCommand | 每次启动 | 写入镜像 entrypoint 脚本 |

**postStartCommand 持久化**:
```
# 镜像内 entrypoint.sh
#!/bin/bash
# 执行 postStartCommand (每次容器启动)
if [ -f /opt/codepod/hooks/postStartCommand ]; then
    source /opt/codepod/hooks/postStartCommand
fi

# 执行用户进程
exec "$@"
```

### 错误处理

- 通过 TS SDK 获取命令执行结果
- 如果构建失败（exit code != 0），返回错误给 devpod
- 构建日志通过 log stream 实时返回

## 生命周期

```
┌─────────────────────────────────────────────────────────────────┐
│                      完整生命周期                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  devpod:                                                        │
│    1. 下载代码仓库 (git clone)                                  │
│    2. 提取 .devcontainer/ 内容                                 │
│    3. 启动 envbuilder 容器                                      │
│    4. 等待 envbuilder 构建完成                                 │
│    5. 拉取镜像                                                  │
│    6. 创建开发容器                                              │
│                                                                  │
│  envbuilder (在容器内):                                         │
│    a. 解析 devcontainer.json                                  │
│    b. 解析 features                                            │
│    c. Kaniko 构建镜像                                          │
│    d. 推送镜像到 Registry                                      │
│                                                                  │
│  开发容器内:                                                    │
│    i.  执行 onCreateCommand                                   │
│    ii. 执行 updateContentCommand (源码挂载后)                  │
│    iii.执行 postCreateCommand                                  │
│    iv. 每次启动执行 postStartCommand                           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```
