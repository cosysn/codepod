# CodePod 设计文档

**日期**: 2026-02-17

**版本**: v1.0

## 1. 概述

### 1.1 项目背景

CodePod 是一个独立的沙盒平台，旨在提供安全隔离的开发环境和代码执行环境。该平台支持多种使用场景，包括 AI Agent 隔离、开发环境快速构建、以及通过 SDK 让 AI 快速执行代码。

### 1.2 核心目标

- 提供高安全隔离的沙盒环境
- 支持多种隔离后端（Docker 优先，可扩展 Firecracker）
- 提供 CLI、SDK 和 API 多种访问方式
- 支持 VSCode Remote SSH 开发
- 支持 Agent 自动更新和卷快照管理

### 1.3 使用场景

| 场景 | 描述 |
|------|------|
| AI Agent 隔离 | 隔离用户环境与 AI Agent 环境，防止 AI 访问敏感资源 |
| Dev Container | 根据 devcontainer 标准快速构建开发环境 |
| 代码执行 | 通过 SDK 让 AI Agent 快速执行代码片段 |

## 2. 系统架构

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            CodePod 平台                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      控制平面 (Node.js)                          │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────────────────┐ │   │
│  │  │   CLI    │  │   SDK    │  │           Server              │ │   │
│  │  │          │  │          │  │         (HTTP API)           │ │   │
│  │  └──────────┘  └──────────┘  └──────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                           │                                           │
│                           │ HTTP API                                    │
│                           ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                     Runner (Go)                                 │   │
│  │  ┌───────────────┐  ┌───────────────┐  ┌─────────────────────┐ │   │
│  │  │  任务调度器    │  │  Docker 操作  │  │ Agent 生命周期管理  │ │   │
│  │  │  Job Queue    │  │   引擎       │  │ - 构建镜像          │ │   │
│  │  │              │  │              │  │ - 注入 Agent        │ │   │
│  │  └───────────────┘  └───────────────┘  │ - 容器生命周期       │ │   │
│  │                                         └─────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                           │                                           │
│                           │ gRPC over TLS (mTLS)                       │
│                           │ - 心跳/状态同步                                                    │
│                           │ - 任务下发 (Job Queue)                                           │
│                           │ - 日志流                                                          │
│                           ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                     Sandbox 容器 (Docker)                         │   │
│  │                                                                   │   │
│  │  ┌───────────────────────────────────────────────────────────┐ │   │
│  │  │                    Agent (Go) - PID 1                      │ │   │
│  │  │                                                           │ │   │
│  │  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐ │ │   │
│  │  │  │ SSH Server  │  │ 进程管理    │  │ Shell/命令执行  │ │ │   │
│  │  │  │ - 端口 22   │  │ - PID 1     │  │ - 交互 Shell   │ │ │   │
│  │  │  │ - 公钥认证  │  │ - 子进程回收│  │ - Exec 命令    │ │ │   │
│  │  │  │ - VSCode   │  │ - 信号转发  │  │ - 管道/重定向  │ │ │   │
│  │  │  │ - 端口转发  │  │ - 资源限制  │  │                 │ │ │   │
│  │  │  └─────────────┘  └─────────────┘  └─────────────────┘ │ │   │
│  │  │                                                           │ │   │
│  │  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐ │ │   │
│  │  │  │ 证书代理    │  │ 文件管理    │  │ 自动更新        │ │ │   │
│  │  │  │ (mTLS)     │  │             │  │ - 版本检测      │ │ │   │
│  │  │  │             │  │             │  │ - 增量下载      │ │ │   │
│  │  │  │             │  │             │  │ - 热更新/重启   │ │ │   │
│  │  │  │             │  │             │  │ - 回滚机制      │ │ │   │
│  │  │  └─────────────┘  └─────────────┘  └─────────────────┘ │ │   │
│  │  │                                                           │ │   │
│  │  └───────────────────────────────────────────────────────────┘ │   │
│  │                                                                   │   │
│  └───────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 组件职责

| 组件 | 职责 | 技术栈 |
|------|------|--------|
| CLI | 命令行管理工具：创建/删除/列表/日志/快照 | Node.js |
| SDK | 供外部程序调用沙盒功能 | Node.js |
| Server | HTTP API 入口，请求路由，认证，版本管理 | Node.js |
| Runner | 容器生命周期管理，Agent 注入，存储管理 | Go |
| Agent | 沙盒内部代理：SSH、代码执行、证书代理、资源监控 | Go |

### 2.3 通信架构

#### 2.3.1 Server 与 Runner 通信

借鉴 Daytona 架构，采用 gRPC over TLS 双向通信：

| 通信方式 | 方向 | 内容 | 频率 |
|----------|------|------|------|
| 心跳 | Runner → Server | 存活状态 + 资源负载 | 每 30 秒 |
| 任务推送 | Server → Runner | Job (创建/销毁/更新) | 按需 |
| 日志流 | Runner → Server | 构建/执行日志 | 构建时 |
| 状态同步 | 双向 | Sandbox 状态变更 | 状态变更时 |

#### 2.3.2 反向隧道

Runner 位于防火墙/NAT 后时，Runner 主动连接 Server：

```
Runner 启动 ──► 主动连接 Server (反向隧道建立)
                │
                ▼
         Server 可以通过隧道下发指令给 Runner
```

#### 2.3.3 mTLS 双向认证

```
┌──────────┐                    ┌──────────┐
│  Server  │◄─── mTLS ────────►│  Runner  │
│  证书    │    双向认证         │  证书    │
└──────────┘                    └──────────┘
```

### 2.4 数据流

```
1. 用户请求
   CLI/SDK ──► HTTP API ──► Server

2. 任务下发
   Server ──(gRPC + mTLS)──► Runner

3. Runner 操作
   Runner ──► Docker API ──► 创建容器 + 注入 Agent

4. 状态/日志回传
   Runner ──(gRPC Stream)──► Server ──► CLI/SDK

5. 用户连接 Sandbox
   CLI/SDK ──(SSH + Token)──► Agent
```

## 3. 隔离后端策略

### 3.1 Phase 1: Docker (当前)

- **安全加固**:
  - seccomp 配置
  - capabilities 限制 (cap-drop)
  - readonly rootfs
  - network namespace 隔离
  - user namespace 映射

### 3.2 Phase 2: Firecracker (后续)

- 虚拟化级别隔离
- 更强安全性
- 适合高安全场景

## 4. Agent 详细设计

### 4.1 核心职责

Agent 作为容器内的 PID 1 进程，负责：

1. **SSH Server**: 提供 SSH 访问能力，支持 VSCode Remote SSH
2. **进程管理**: 子进程回收，信号转发，资源限制
3. **Shell/命令执行**: 交互式 Shell，单命令执行，管道/重定向
4. **证书代理**: mTLS 双向认证
5. **端口转发**: 本地/远程/动态端口转发
6. **文件管理**: 文件上传/下载/管理
7. **自动更新**: 版本检测，下载更新，热更新/重启

### 4.2 工作模式

#### 模式 1: 交互式 Shell (开发场景)

```
终端 ──► SSH ──► Agent ──► bash (用户 Shell)
```

#### 模式 2: 单命令执行 (AI Agent)

```
AI SDK ──► SSH ──► Agent ──► exec (ls/grep/python 等)
```

#### 模式 3: VSCode Remote SSH

```
VSCode ──► SSH ──► Agent ──► 远程开发环境
           │
           ├──► 代码编辑
           ├──► 终端
           └──► 调试
```

### 4.3 SSH Server 能力

| 能力 | 描述 |
|------|------|
| 公钥认证 | authorized_keys 配置 |
| VSCode Remote SSH | 支持 Remote Development |
| 端口转发 | 本地/远程/动态转发 |
| X11 转发 | 可选支持 |
| Agent Forwarding | SSH 代理转发 |

### 4.4 端口转发类型

| 类型 | 方向 | 用例 |
|------|------|------|
| 本地端口转发 | 本地 → 沙盒 | localhost:8080 → 容器:8080 |
| 远程端口转发 | 沙盒 → 本地/公网 | 容器服务暴露给外部 |
| 动态端口转发 | 代理 | SOCKS5 代理 |

### 4.5 Agent 自动更新

#### 更新策略

| 策略 | 描述 | 适用场景 |
|------|------|----------|
| 手动更新 | 管理员触发 | 生产环境 |
| 自动更新 | 检测到新版本自动更新 | 开发环境 |
| 定时更新 | 维护窗口期统一更新 | 企业环境 |
| 灰度更新 | 先更新部分实例 | 大规模部署 |

#### 更新流程

```
1. Server 发布新版本 Agent
2. Runner 心跳上报当前版本
3. Server 检测版本差异，下发更新指令
4. Runner 下载新版本 (增量更新)
5. Runner 验证签名
6. 执行更新 (热更新或重启)
7. 确认版本，回滚机制 (如失败)
```

## 5. 存储管理

### 5.1 卷挂载

| 类型 | 描述 | 用例 |
|------|------|------|
| 绑定挂载 | 挂载主机目录 | 共享代码、配置文件 |
| 命名卷 | Docker 卷管理 | 持久化数据 |
| 只读挂载 | 限制写入 | 模板、依赖库 |

### 5.2 快照管理

| 能力 | 描述 |
|------|------|
| 创建快照 | 保存当前状态 (文件系统 + 配置) |
| 列出快照 | 查看历史快照 |
| 恢复快照 | 回滚到指定快照 |
| 克隆快照 | 基于快照创建新 Sandbox |

## 6. API 设计

### 6.1 REST API

#### 创建 Sandbox

```http
POST /api/v1/sandboxes
Content-Type: application/json

{
  "type": "dev-container" | "code-executor",
  "image": "python:3.11",
  "resources": {
    "cpu": 2,
    "memory": "4Gi"
  },
  "env": {
    "KEY": "value"
  },
  "volumes": [
    {
      "source": "/path/to/host",
      "target": "/workspace",
      "readonly": false
    }
  ],
  "devcontainer": {
    "path": ".devcontainer"
  }
}
```

```http
HTTP/1.1 201 Created
Content-Type: application/json

{
  "id": "sbox_abc123",
  "ssh": {
    "host": "localhost",
    "port": 2222,
    "user": "root"
  },
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "expiresAt": "2026-02-17T16:30:00Z"
}
```

#### 获取 Sandbox 信息

```http
GET /api/v1/sandboxes/:id
```

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "id": "sbox_abc123",
  "status": "running",
  "ssh": {
    "host": "localhost",
    "port": 2222,
    "user": "root"
  },
  "resources": {
    "cpu": 2,
    "memory": "4Gi"
  },
  "createdAt": "2026-02-17T15:00:00Z",
  "expiresAt": "2026-02-17T16:00:00Z"
}
```

#### 删除 Sandbox

```http
DELETE /api/v1/sandboxes/:id
```

#### 创建快照

```http
POST /api/v1/sandboxes/:id/snapshots
Content-Type: application/json

{
  "name": "snapshot-v1",
  "description": "Initial state"
}
```

```http
HTTP/1.1 201 Created
Content-Type: application/json

{
  "id": "snap_xyz789",
  "name": "snapshot-v1",
  "createdAt": "2026-02-17T15:30:00Z"
}
```

#### 恢复快照

```http
POST /api/v1/sandboxes/:id/snapshots/:snapId/restore
```

### 6.2 SDK 使用示例

```typescript
import { CodePod } from '@codepod/sdk';

const pod = new CodePod({ endpoint: 'http://localhost:8080' });

// 创建开发环境
const devEnv = await pod.createDevContainer({
  devcontainerUrl: 'github.com/user/repo',
  timeout: '1h'
});

console.log('SSH 连接信息:', devEnv.ssh);

// 执行代码
const result = await pod.runCode({
  language: 'python',
  code: 'print("hello world")',
  timeout: '30s'
});

console.log('执行结果:', result.output);

// 创建快照
await pod.createSnapshot(devEnv.id, {
  name: 'before-experiment',
  description: 'State before experiment'
});
```

### 6.3 CLI 命令

```bash
# 创建 Sandbox
codepod create --type dev-container --image python:3.11

# 列出 Sandbox
codepod list

# 查看 Sandbox 状态
codepod status sbox_abc123

# 删除 Sandbox
codepod delete sbox_abc123

# 创建快照
codepod snapshot create sbox_abc123 --name snap-v1

# 恢复快照
codepod snapshot restore sbox_abc123 --name snap-v1

# 查看日志
codepod logs sbox_abc123

# SSH 连接
codepod ssh sbox_abc123
```

## 7. 生命周期管理

### 7.1 当前策略 (Phase 1)

所有 Sandbox 按需创建/销毁：

```
用户请求 ──► 创建 Sandbox ──► Runner 创建容器 ──► Agent 启动
                                      │
                                      ▼
                               用户使用 Sandbox
                                      │
                                      ▼
                               超时/手动删除 ──► 清理资源
```

### 7.2 后续优化 (Phase 2)

根据使用场景选择生命周期策略：

| 场景 | 策略 | 说明 |
|------|------|------|
| 开发环境 | 按需创建 | 资源敏感度低 |
| AI 代码执行 | 池化 | 对执行时间敏感 |

## 8. 认证与安全

### 8.1 认证方式

| 方式 | 用途 |
|------|------|
| Token + 动态密钥 | CLI/SDK/API 临时访问 |
| 公钥认证 | VSCode Remote SSH 持久连接 |
| mTLS | Server 与 Runner 之间双向认证 |

### 8.2 安全措施

- **传输加密**: gRPC over TLS，SSH 加密传输
- **认证**: mTLS 双向认证，公钥认证
- **隔离**: Docker 安全加固，seccomp，cap-drop
- **审计**: 操作日志记录

## 9. 技术栈

| 组件 | 语言 | 技术选型 |
|------|------|----------|
| CLI | Node.js | TypeScript, Commander.js |
| SDK | Node.js | TypeScript |
| Server | Node.js | TypeScript, Express/Fastify |
| Runner | Go | gRPC, Docker SDK, Firecracker SDK |
| Agent | Go | SSH Server (golang.org/x/crypto/ssh), 进程管理 |

## 10. 目录结构

```
codepod/
├── cmd/
│   ├── cli/                    # CLI 入口
│   └── server/                # Server 入口
├── pkg/
│   ├── cli/                   # CLI 实现
│   ├── sdk/                   # SDK 实现
│   └── api/                   # API 类型定义
├── internal/
│   ├── server/                # Server 实现
│   ├── runner/                # Runner 实现
│   │   ├── docker/           # Docker 操作
│   │   ├── firecracker/      # Firecracker 操作 (未来)
│   │   └── storage/           # 存储管理
│   └── agent/                 # Agent 实现
│       ├── ssh/               # SSH Server
│       ├── process/           # 进程管理
│       ├── exec/              # 命令执行
│       ├── tunnel/            # 端口转发
│       └── update/            # 自动更新
├── proto/
│   └── runner.proto           # gRPC 协议定义
├── docs/
│   └── plans/                 # 设计文档
├── scripts/
│   └── build-agent.sh         # Agent 构建脚本
├── package.json
├── go.mod
└── README.md
```

## 11. 后续规划

### Phase 1 (当前)

- [ ] 实现 Docker 后端 Runner
- [ ] 实现 Agent 核心功能 (SSH、命令执行)
- [ ] 实现 CLI 和 SDK
- [ ] 实现 Server HTTP API
- [ ] 实现卷挂载功能
- [ ] 实现快照功能

### Phase 2 (后续)

- [ ] Firecracker 后端支持
- [ ] 池化生命周期管理
- [ ] Web 管理界面
- [ ] Agent 自动更新

## 12. 参考

- [Daytona](https://www.daytona.io/) - Sandboxing 架构参考
- [devcontainer](https://containers.dev/) - 开发容器标准
- [Firecracker](https://firecracker-microvm.io/) - 轻量级虚拟化
