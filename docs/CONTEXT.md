# CodePod 项目上下文摘要

> 最后更新: 2026-02-17

## 项目概述

CodePod 是一个沙盒平台，用于：
1. **AI Agent 隔离** - 隔离用户环境和 AI Agent 环境
2. **开发环境沙盒** - 根据 devcontainer 标准快速构建开发环境
3. **代码执行 SDK** - 支持 AI 快速执行代码

## 技术栈

| 组件 | 语言 | 框架 |
|------|------|------|
| CLI | TypeScript | commander.js + inquirer.js |
| Server | TypeScript | Express.js + Prisma |
| Agent | Go | 标准库 + SSH |
| Runner | Go | Docker SDK |

## 已完成的设计文档

| 文档 | 状态 | 主要内容 |
|------|------|----------|
| `codepod-design.md` | ✅ | 项目概述、API 设计、安全、Tech Stack |
| `codepod-architecture.md` | ✅ | 三层架构、8 子系统、gRPC+mTLS 通信 |
| `codepod-code-structure.md` | ✅ | Monorepo 结构、Go workspace、Makefile |
| `agent-design.md` | ✅ | SSH Server、命令执行、隧道管理、自动更新 |
| `runner-design.md` | ✅ | Job 调度、资源管理、Webhook、审计、多 Workspace |
| `server-design.md` | ✅ | REST API、SQLite/PostgreSQL、gRPC Server、JWT 认证 |
| `cli-design.md` | ✅ | 命令行工具、SSH 连接、REPL 模式 |

## 架构总览

```
┌─────────────────────────────────────────────────────────┐
│                      Control Plane                       │
│  ┌─────────────────┐    ┌─────────────────────────┐  │
│  │   CLI/SDK       │───▶│   Server (REST API)     │  │
│  │   (TypeScript)  │    │   (Express.js)          │  │
│  └─────────────────┘    └───────────┬─────────────┘  │
└────────────────────────────────────┼──────────────────┘
                                     │
                              gRPC (mTLS)
                                     │
┌────────────────────────────────────┼──────────────────┐
│                      Orchestration Plane               │
│  ┌─────────────────┐    ┌─────────────────────────┐  │
│  │   Runner Pool   │◀───│   Server (gRPC Server)│  │
│  │   (Go)         │    │   (接收 Runner 连接)    │  │
│  └────────┬────────┘    └─────────────────────────┘  │
└───────────┼───────────────────────────────────────────┘
            │ gRPC (Runner Service)
            ▼
┌─────────────────────────────────────────────────────────┐
│                      Sandbox Plane                       │
│  ┌─────────────────┐  ┌─────────────────┐              │
│  │   Runner 1      │  │   Runner N      │              │
│  │   (Docker)      │  │   (Docker/K8s)  │              │
│  │                 │  │                 │              │
│  │  ┌───────────┐  │  │  ┌───────────┐  │              │
│  │  │  Agent   │  │  │  │  Agent   │  │              │
│  │  │ (SSH)    │  │  │  │ (SSH)    │  │              │
│  │  └───────────┘  │  │  └───────────┘  │              │
│  └─────────────────┘  └─────────────────┘              │
└─────────────────────────────────────────────────────────┘
```

## 核心设计决策

### 1. Runner 连接方式
- **问题**: Runner 可能在 NAT/防火墙后面，Server 无法直接连接
- **解决**: Server 作为 gRPC Server 监听，Runner 主动连接（反向隧道）
- **端口**: Server gRPC (50051), REST API (3000)

### 2. 数据库选择
- **默认**: SQLite（单文件部署）
- **可选**: PostgreSQL（生产环境）
- **切换**: 修改 DATABASE_URL 环境变量

### 3. 认证方式
- **API Key**: CLI/SDK 访问 REST API
- **JWT Token**: 用户登录（可选）
- **SSH Token**: Sandbox 连接认证

### 4. SSH 连接流程
```
1. CLI 获取 Sandbox 信息和 Token
2. CLI 解析 SSH 主机和端口
3. SSH 连接到 Agent (root@host:22)
4. Agent 验证 Token
5. 建立 Shell 会话
```

## 待实现功能

### 高优先级

| 功能 | 组件 | 描述 |
|------|------|------|
| SDK-Go | libs/sdk-go | Go 语言 SDK |
| SDK-TypeScript | libs/sdk-typescript | TypeScript SDK |
| SDK-Python | libs/sdk-python | Python SDK |
| 单元测试 | 所有组件 | 单元测试覆盖 |

### 中优先级

| 功能 | 组件 | 描述 |
|------|------|------|
| Web UI | apps/web | 管理界面 |
| Docker 镜像构建 | images/ | 内置镜像 |
| CI/CD | .github/ | GitHub Actions |

## 项目结构

```
codepod/
├── apps/
│   ├── agent/          # Agent (Go)
│   ├── runner/        # Runner (Go)
│   ├── server/        # Server (TypeScript)
│   └── cli/           # CLI (TypeScript)
├── libs/
│   ├── sdk-go/        # Go SDK
│   ├── sdk-python/    # Python SDK
│   └── sdk-typescript/# TypeScript SDK
├── proto/             # gRPC 协议定义
├── images/            # Docker 镜像
├── docker/            # Docker 构建文件
├── .github/           # CI/CD
└── docs/
    └── plans/         # 设计文档
```

## 关键文件

| 文件 | 说明 |
|------|------|
| `proto/runner/runner.proto` | gRPC 协议定义 |
| `prisma/schema.prisma` | 数据库模型 |
| `apps/server/src/grpc/server.ts` | gRPC Server 实现 |
| `apps/cli/src/commands/sandbox/ssh.ts` | SSH 连接实现 |

## 本地开发

```bash
# 安装依赖
cd apps/server && npm install
cd apps/cli && npm install
cd libs/sdk-go && go mod download

# 运行 Server
cd apps/server && npm run dev

# 运行 CLI
cd apps/cli && npm run dev -- sandbox list

# 运行 Agent (开发模式)
cd apps/agent && go run main.go

# 运行 Runner (开发模式)
cd apps/runner && go run main.go
```

## Git 提交历史

```
# 最近的提交
61098f8 fix: address CLI design issues
7a052d0 fix: address critical Server design issues
fe3b85c feat: add CLI subsystem design
b4eb2ae feat: add images directory and README.md
...
```

## 测试命令

```bash
# CLI 帮助
codepod --help

# 查看版本
codepod --version

# 配置 API Key
codepod config set API_KEY <key>

# 创建 Sandbox
codepod sandbox create test --image python:3.11

# SSH 连接
codepod sandbox ssh <sandbox_id>

# 列出 Sandbox
codepod sandbox list
```

## 下一步行动

1. **实现 SDK** - 从 `docs/plans/` 中的设计文档实现 Go/TypeScript/Python SDK
2. **实现 Server** - 实现 REST API 和 gRPC Server
3. **实现 Agent** - 实现 SSH Server 和命令执行
4. **实现 Runner** - 实现 Job 调度和 Docker 管理
5. **集成测试** - 端到端测试

## 联系方式

如有问题，请查看：
- 设计文档: `docs/plans/*.md`
- Git 历史: `git log --oneline`
- 架构图: `docs/plans/codepod-architecture.md`
