# CodePod 代码目录与构建系统设计

**版本**: v1.0
**日期**: 2026-02-17

## 1. 项目整体结构

```
codepod/
├── cmd/                          # 命令行入口
│   ├── cli/                      # CLI 入口
│   │   ├── main.go
│   │   └── main_test.go
│   └── server/                   # Server 入口
│       ├── main.go
│       └── main_test.go
│
├── pkg/                          # 公共包 (可被外部导入)
│   ├── api/                      # API 类型定义
│   │   ├── types.go
│   │   └── types_test.go
│   ├── client/                   # 客户端库
│   │   ├── client.go
│   │   └── client_test.go
│   └── errors/                   # 错误定义
│       ├── errors.go
│       └── errors_test.go
│
├── internal/                     # 内部包 (不可被外部导入)
│   ├── server/                   # Server 实现
│   │   ├── server.go
│   │   ├── server_test.go
│   │   ├── handler/             # HTTP 处理器
│   │   │   ├── sandbox.go
│   │   │   ├── snapshot.go
│   │   │   └── handler_test.go
│   │   ├── service/             # 业务逻辑
│   │   │   ├── sandbox.go
│   │   │   ├── snapshot.go
│   │   │   └── service_test.go
│   │   ├── storage/             # 数据存储
│   │   │   ├── db.go
│   │   │   └── cache.go
│   │   └── middleware/          # 中间件
│   │       ├── auth.go
│   │       ├── log.go
│   │       └── middleware_test.go
│   │
│   ├── runner/                   # Runner 实现
│   │   ├── runner.go
│   │   ├── runner_test.go
│   │   ├── docker/              # Docker 操作
│   │   │   ├── client.go
│   │   │   ├── container.go
│   │   │   ├── image.go
│   │   │   └── docker_test.go
│   │   ├── job/                 # 任务调度
│   │   │   ├── scheduler.go
│   │   │   ├── queue.go
│   │   │   └── job_test.go
│   │   └── storage/             # 存储管理
│   │       ├── volume.go
│   │       └── snapshot.go
│   │
│   └── agent/                    # Agent 实现
│       ├── main.go
│       ├── agent.go
│       ├── ssh/                  # SSH 服务器
│       │   ├── server.go
│       │   ├── session.go
│       │   ├── auth.go
│       │   └── ssh_test.go
│       ├── process/             # 进程管理
│       │   ├── manager.go
│       │   ├── process.go
│       │   └── process_test.go
│       ├── exec/                # 命令执行
│       │   ├── executor.go
│       │   └── exec_test.go
│       ├── tunnel/              # 端口转发
│       │   ├── manager.go
│       │   └── tunnel_test.go
│       └── update/              # 自动更新
│           ├── updater.go
│           └── update_test.go
│
├── proto/                       # Protobuf 定义
│   ├── runner.proto
│   ├── agent.proto
│   └── buf.yaml                # Buf 配置
│
├── server/                      # Server 前端 (Node.js/TypeScript)
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts            # 入口
│   │   ├── routes/             # 路由
│   │   │   ├── sandbox.ts
│   │   │   └── snapshot.ts
│   │   ├── services/           # 服务
│   │   │   ├── sandbox.ts
│   │   │   └── snapshot.ts
│   │   ├── middleware/         # 中间件
│   │   │   ├── auth.ts
│   │   │   └── logger.ts
│   │   └── types/              # 类型
│   │       └── index.ts
│   ├── dist/                   # 编译输出
│   └── test/                   # 测试
│
├── sdk/                         # SDK (Node.js/TypeScript)
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts
│   │   ├── client.ts
│   │   ├── sandbox.ts
│   │   ├── snapshot.ts
│   │   └── types.ts
│   ├── dist/
│   └── test/
│
├── cli/                         # CLI (Node.js/TypeScript)
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts
│   │   ├── commands/           # 命令
│   │   │   ├── create.ts
│   │   │   ├── delete.ts
│   │   │   ├── list.ts
│   │   │   ├── ssh.ts
│   │   │   └── snapshot.ts
│   │   └── utils/              # 工具
│   │       ├── config.ts
│   │       └── ssh.ts
│   ├── dist/
│   └── test/
│
├── scripts/                     # 构建脚本
│   ├── build-agent.sh
│   ├── build-runner.sh
│   ├── build-server.sh
│   ├── build-cli.sh
│   ├── build-sdk.sh
│   ├── build-all.sh
│   ├── docker/
│   │   ├── Dockerfile.agent
│   │   ├── Dockerfile.runner
│   │   └── Dockerfile.server
│   └── build-docker.sh
│
├── docs/                       # 文档
│   └── plans/
│
├── Makefile                    # 构建 Makefile
├── go.mod                      # Go 模块
├── go.sum
├── package.json               # Node.js 根配置 (workspace)
├── lerna.json                 # Lerna 配置 (monorepo)
├── buf.yaml                   # Protobuf 配置
├── .golangci.yml             # Go lint 配置
├── .eslintrc.js              # ESLint 配置
├── .prettierrc               # Prettier 配置
└── README.md
```

## 2. 技术栈与构建工具

### 2.1 技术栈

| 组件 | 语言 | 构建工具 | 包管理 |
|------|------|----------|--------|
| CLI | TypeScript | esbuild/tsc | npm/yarn/pnpm |
| SDK | TypeScript | esbuild/tsc | npm/yarn/pnpm |
| Server | TypeScript | esbuild/tsc | npm/yarn/pnpm |
| Runner | Go | go build | go mod |
| Agent | Go | go build | go mod |
| Protobuf | - | buf | - |

### 2.2 Monorepo 结构

```
codepod/
├── package.json              # 根 workspace 配置
├── lerna.json                # Lerna 多包管理
│
├── server/package.json       # Server 包
├── sdk/package.json          # SDK 包
└── cli/package.json          # CLI 包
```

**根 package.json:**
```json
{
  "name": "codepod",
  "private": true,
  "workspaces": [
    "server",
    "sdk",
    "cli"
  ],
  "scripts": {
    "build": "lerna run build",
    "test": "lerna run test",
    "lint": "lerna run lint"
  }
}
```

## 3. 构建系统设计

### 3.1 构建流程

```
┌─────────────────────────────────────────────────────────┐
│                    构建流程                                │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. 准备阶段                                           │
│     ├── 安装 Go 依赖 (go mod download)                │
│     ├── 安装 Node.js 依赖 (npm install)               │
│     └── 生成 Protobuf 代码 (buf generate)              │
│                                                         │
│  2. 编译阶段                                           │
│     ├── 构建 Agent (Go)                               │
│     ├── 构建 Runner (Go)                              │
│     ├── 构建 Server (TypeScript → JavaScript)         │
│     ├── 构建 SDK (TypeScript → JavaScript)            │
│     └── 构建 CLI (TypeScript → JavaScript)            │
│                                                         │
│  3. 打包阶段                                           │
│     ├── 打包 Agent 到 Docker 镜像                      │
│     ├── 打包 Runner 到 Docker 镜像                    │
│     ├── 打包 Server 到 Docker 镜像                    │
│     └── 创建发布包 (tar/zip)                          │
│                                                         │
│  4. 测试阶段                                           │
│     ├── Go 测试 (go test)                             │
│     ├── Node.js 测试 (jest)                           │
│     ├── Protobuf 验证 (buf lint)                      │
│     └── 集成测试                                      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 3.2 Makefile

```makefile
# Makefile

.PHONY: all build test clean proto agent runner server sdk cli docker

# 默认目标
all: build

# 生成 Protobuf
proto:
	buf generate

# 构建 Agent
agent:
	cd agent && go build -o ../../bin/agent ./...

# 构建 Runner
runner:
	cd runner && go build -o ../../bin/runner ./...

# 构建 Server
server:
	cd server && npm run build

# 构建 SDK
sdk:
	cd sdk && npm run build

# 构建 CLI
cli:
	cd cli && npm run build

# 构建全部
build: proto agent runner server sdk cli

# 测试
test: test-go test-node

test-go:
	cd agent && go test ./...
	cd runner && go test ./...

test-node:
	cd server && npm test
	cd sdk && npm test
	cd cli && npm test

# Docker 镜像
docker: docker-build

docker-build:
	./scripts/build-docker.sh

# 清理
clean:
	rm -rf bin/
	cd server && rm -rf dist/
	cd sdk && rm -rf dist/
	cd cli && rm -rf dist/
```

### 3.3 构建脚本

**scripts/build-all.sh:**
```bash
#!/bin/bash
set -e

echo "Building CodePod..."

# 1. 生成 Protobuf
echo "Generating Protobuf..."
buf generate

# 2. 构建 Go 组件
echo "Building Agent..."
cd agent && go build -o ../bin/agent .

echo "Building Runner..."
cd runner && go build -o ../bin/runner .

# 3. 构建 Node.js 组件
echo "Building Server..."
cd server && npm run build

echo "Building SDK..."
cd sdk && npm run build

echo "Building CLI..."
cd cli && npm run build

echo "Build complete!"
```

## 4. Docker 构建

### 4.1 Agent Docker 镜像

```dockerfile
# Dockerfile.agent
FROM golang:1.21-alpine AS builder

WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o agent ./agent

FROM alpine:3.18

RUN apk add --no-cache openssh-server ca-certificates

WORKDIR /app
COPY --from=builder /build/agent /app/agent

EXPOSE 22

ENTRYPOINT ["/app/agent"]
```

### 4.2 Runner Docker 镜像

```dockerfile
# Dockerfile.runner
FROM golang:1.21-alpine AS builder

WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=1 go build -o runner ./runner

FROM alpine:3.18

RUN apk add --no-cache docker-cli ca-certificates

WORKDIR /app
COPY --from=builder /build/runner /app/runner
COPY --from=builder /build/bin/agent /app/bin/agent

ENTRYPOINT ["/app/runner"]
```

### 4.3 Server Docker 镜像

```dockerfile
# Dockerfile.server
FROM node:20-alpine AS builder

WORKDIR /build
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine

WORKDIR /app
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/node_modules ./node_modules

EXPOSE 3000

CMD ["node", "dist/index.js"]
```

## 5. 目录设计原则

### 5.1 Go 项目结构 (Standard Go Project Layout)

```
cmd/           # 可执行入口
pkg/           # 可被外部导入的公共库
internal/      # 内部包，不可被外部导入
proto/         # Protobuf 定义
```

### 5.2 Node.js 项目结构

```
src/           # 源代码
dist/          # 编译输出
test/          # 测试文件
```

### 5.3 命名规范

| 类型 | 规范 | 示例 |
|------|------|------|
| 文件 | 小写字母 + 连字符 | `sandbox_handler.ts` |
| 目录 | 小写字母 + 连字符 | `internal/server` |
| 包 | 小写字母 | `internal/server` |
| 类 | 大驼峰 | `SandboxHandler` |
| 函数 | 小驼峰 | `createSandbox` |
| 常量 | 全大写 + 下划线 | `MAX_RETRIES` |

## 6. 依赖管理

### 6.1 Go 依赖

**go.mod:**
```go
module github.com/codepod/codepod

go 1.21

require (
	github.com/docker/docker v24.0.0
	google.golang.org/grpc v1.58.0
	google.golang.org/protobuf v1.31.0
)
```

### 6.2 Node.js 依赖

**server/package.json:**
```json
{
  "name": "@codepod/server",
  "version": "1.0.0",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "test": "jest",
    "lint": "eslint src --ext .ts"
  },
  "dependencies": {
    "express": "^4.18.0",
    "@codepod/sdk": "1.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/node": "^20.0.0",
    "jest": "^29.0.0",
    "eslint": "^8.0.0"
  }
}
```

## 7. 发布流程

### 7.1 版本号规则

采用语义化版本 `vMAJOR.MINOR.PATCH`:
- MAJOR: 不兼容的 API 变更
- MINOR: 向后兼容的功能新增
- PATCH: 向后兼容的 bug 修复

### 7.2 发布步骤

```bash
# 1. 更新版本号
npm version patch  # 或 minor/major

# 2. 构建所有组件
make build

# 3. 运行测试
make test

# 4. 构建 Docker 镜像
make docker

# 5. 标记 Git
git tag v1.0.0
git push origin v1.0.0
```

## 8. 开发工作流

### 8.1 本地开发

```bash
# 1. 克隆代码
git clone https://github.com/codepod/codepod.git
cd codepod

# 2. 安装依赖
npm install
go mod download

# 3. 生成 Protobuf
buf generate

# 4. 启动 Server
cd server && npm run dev

# 5. 启动 Runner (开发模式)
cd runner && go run . --dev

# 6. 使用 CLI
cd cli && npm link
codepod list
```

### 8.2 热重载

- Server: 使用 `nodemon` 或 `ts-node-dev`
- Runner: 使用 `air` (Go 热重载)
- Agent: 手动重启

## 9. 跨语言调用

### 9.1 Protobuf 定义

```protobuf
// proto/runner.proto
syntax = "proto3";

package codepod;

service RunnerService {
  rpc CreateSandbox(CreateSandboxRequest) returns (SandboxInfo);
  rpc DeleteSandbox(DeleteSandboxRequest) returns (Empty);
  rpc GetSandbox(GetSandboxRequest) returns (SandboxInfo);
}

message CreateSandboxRequest {
  string type = 1;
  string image = 2;
  Resources resources = 3;
}
```

### 9.2 gRPC 服务

```
Server (Node.js) ◄──gRPC──► Runner (Go)
         │
         │ HTTP API
         ▼
CLI/SDK (Node.js)
```

## 10. 文件命名约定

| 目录/文件 | 命名 | 示例 |
|-----------|------|------|
| Go 源文件 | `snake_case.go` | `sandbox_handler.go` |
| TypeScript 源文件 | `kebab-case.ts` | `sandbox-handler.ts` |
| 测试文件 | `*_test.go` / `*.test.ts` | `sandbox_test.go` |
| Protobuf | `snake_case.proto` | `runner.proto` |
| 配置 | `kebab-case.yaml` | `buf.yaml` |
