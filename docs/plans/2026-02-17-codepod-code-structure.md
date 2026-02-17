# CodePod 代码目录与构建系统设计

**版本**: v2.0
**日期**: 2026-02-17

## 1. 项目整体结构

```
codepod/
├── apps/                          # 核心应用
│   ├── agent/                      # Agent (Go)
│   │   ├── cmd/                   # 入口
│   │   │   └── main.go
│   │   ├── pkg/                   # 公共包
│   │   │   ├── ssh/              # SSH 服务器
│   │   │   ├── process/          # 进程管理
│   │   │   ├── exec/             # 命令执行
│   │   │   ├── tunnel/           # 端口转发
│   │   │   └── update/           # 自动更新
│   │   ├── internal/             # 内部包
│   │   │   └── agent/           # Agent 核心逻辑
│   │   ├── go.mod
│   │   └── go.sum
│   │
│   ├── runner/                    # Runner (Go)
│   │   ├── cmd/
│   │   │   └── main.go
│   │   ├── pkg/
│   │   │   ├── docker/           # Docker 操作
│   │   │   ├── job/              # 任务调度
│   │   │   └── storage/          # 存储管理
│   │   ├── internal/
│   │   │   └── runner/           # Runner 核心逻辑
│   │   ├── go.mod
│   │   └── go.sum
│   │
│   ├── server/                    # Server (Node.js/TypeScript)
│   │   ├── src/
│   │   │   ├── cmd/              # 入口
│   │   │   │   └── index.ts
│   │   │   ├── routes/           # 路由
│   │   │   ├── services/         # 服务
│   │   │   ├── middleware/       # 中间件
│   │   │   └── types/            # 类型
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── cli/                      # CLI (Node.js/TypeScript)
│       ├── src/
│       │   ├── cmd/              # 入口
│       │   │   └── index.ts
│       │   ├── commands/         # 命令
│       │   │   ├── create.ts
│       │   │   ├── delete.ts
│       │   │   ├── list.ts
│       │   │   ├── ssh.ts
│       │   │   └── snapshot.ts
│       │   └── utils/            # 工具
│       ├── package.json
│       └── tsconfig.json
│
├── libs/                          # 多语言 SDK
│   ├── sdk-go/                   # Go SDK
│   │   ├── client/               # 客户端
│   │   ├── types/               # 类型定义
│   │   ├── sandbox/              # Sandbox 操作
│   │   ├── snapshot/             # 快照操作
│   │   ├── go.mod
│   │   └── go.sum
│   │
│   ├── sdk-python/               # Python SDK
│   │   ├── codepod/
│   │   │   ├── __init__.py
│   │   │   ├── client.py
│   │   │   ├── sandbox.py
│   │   │   └── snapshot.py
│   │   ├── pyproject.toml
│   │   └── setup.py
│   │
│   ├── sdk-typescript/           # TypeScript SDK
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── client.ts
│   │   │   ├── sandbox.ts
│   │   │   └── snapshot.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── sdk-rust/                 # Rust SDK (可选)
│       ├── src/
│       │   ├── lib.rs
│       │   ├── client.rs
│       │   └── sandbox.rs
│       ├── Cargo.toml
│       └── Cargo.lock
│
├── proto/                         # Protobuf 定义
│   ├── runner/
│   │   ├── runner.proto
│   │   └── runner.pb.go
│   ├── agent/
│   │   ├── agent.proto
│   │   └── agent.pb.go
│   └── buf.yaml
│
├── docker/                        # Docker 构建文件
│   ├── Dockerfile.agent
│   ├── Dockerfile.runner
│   ├── Dockerfile.server
│   ├── docker-compose.yml
│   └── scripts/
│       ├── build-agent.sh
│       ├── build-runner.sh
│       ├── build-server.sh
│       └── build-all.sh
│
├── .github/                       # GitHub 配置
│   └── workflows/
│       ├── build.yml              # 构建 workflow
│       ├── test.yml              # 测试 workflow
│       ├── release.yml           # 发布 workflow
│       └── docker.yml            # Docker 构建
│
├── scripts/                       # 构建脚本
│   ├── build-go.sh
│   ├── build-all.sh
│   └── generate-proto.sh
│
├── images/                         # 内置镜像
│   ├── python/                     # Python 执行环境
│   │   ├── Dockerfile
│   │   ├── requirements.txt
│   │   └── .dockerignore
│   ├── nodejs/                    # Node.js 执行环境
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── .dockerignore
│   ├── go/                        # Go 执行环境
│   │   ├── Dockerfile
│   │   └── .dockerignore
│   ├── base/                      # 基础镜像 (含 Agent)
│   │   ├── Dockerfile
│   │   └── agent/
│   └── README.md                  # 镜像说明
│
├── docs/                          # 文档
│   └── plans/
│
├── go.work                        # Go workspace
├── go.work.sum
├── Makefile
├── package.json                   # Node.js 根配置 (workspace)
├── buf.gen.yaml                   # Protobuf 生成配置
├── .golangci.yml                  # Go lint 配置
├── .eslintrc.js                   # ESLint 配置
└── README.md
```

## 2. Go Workspace

### 2.1 go.work

```go
// go.work
go 1.21

use (
	./apps/agent
	./apps/runner
	./libs/sdk-go
)
```

### 2.2 模块依赖关系

```
┌─────────────────────────────────────────────────────────┐
│                   Go Workspace 结构                       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  apps/agent                                            │
│  apps/runner                                           │
│       │                                                │
│       │ 依赖                                           │
│       ▼                                                │
│  libs/sdk-go ◄── proto/                               │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## 3. 技术栈

| 组件 | 语言 | 构建工具 | 包管理 |
|------|------|----------|--------|
| CLI | TypeScript | esbuild/tsc | npm/pnpm |
| Server | TypeScript | esbuild/tsc | npm/pnpm |
| SDK (TS) | TypeScript | esbuild/tsc | npm/pnpm |
| SDK (Python) | Python | setuptools/pip | pip |
| SDK (Go) | Go | go build | go mod |
| Runner | Go | go build | go mod |
| Agent | Go | go build | go mod |

## 4. 构建系统

### 4.1 Makefile

```makefile
.PHONY: all build test clean proto docker

# 默认目标
all: build

# 构建所有
build: build-go build-ts build-python

# 构建 Go 组件
build-go:
	cd apps/agent && go build -o ../../bin/agent ./cmd
	cd apps/runner && go build -o ../../bin/runner ./cmd

# 构建 TypeScript 组件
build-ts:
	cd apps/server && npm run build
	cd apps/cli && npm run build
	cd libs/sdk-typescript && npm run build

# 构建 Python SDK
build-python:
	cd libs/sdk-python && python -m build

# 生成 Protobuf
proto:
	buf generate

# 测试
test: test-go test-ts test-python

test-go:
	cd apps/agent && go test ./...
	cd apps/runner && go test ./...
	cd libs/sdk-go && go test ./...

test-ts:
	cd apps/server && npm test
	cd apps/cli && npm test

test-python:
	cd libs/sdk-python && pytest

# Docker 构建
docker:
	./docker/scripts/build-all.sh

# 清理
clean:
	rm -rf bin/
	find . -name "dist" -type d -exec rm -rf {} +
```

### 4.2 构建流程

```
┌─────────────────────────────────────────────────────────┐
│                    构建流程                                │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. Protobuf 代码生成                                  │
│     buf generate                                       │
│                                                         │
│  2. Go 组件构建                                        │
│     ├── apps/agent → bin/agent                        │
│     ├── apps/runner → bin/runner                       │
│     └── libs/sdk-go → sdk-go                          │
│                                                         │
│  3. TypeScript 组件构建                                │
│     ├── apps/server → apps/server/dist                │
│     ├── apps/cli → apps/cli/dist                     │
│     └── libs/sdk-typescript → libs/sdk-typescript/dist│
│                                                         │
│  4. Python SDK 构建                                    │
│     └── libs/sdk-python → wheel package               │
│                                                         │
│  5. Docker 镜像构建                                    │
│     ├── codepod/agent:latest                         │
│     ├── codepod/runner:latest                        │
│     └── codepod/server:latest                        │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## 5. GitHub Workflows

### 5.1 构建 Workflow

```yaml
# .github/workflows/build.yml
name: Build

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Go
        uses: actions/setup-go@v5
        with:
          go-version: '1.21'
          workspace: go.work

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: |
          go mod download
          npm ci

      - name: Generate Proto
        run: buf generate

      - name: Build
        run: make build

      - name: Test
        run: make test
```

### 5.2 Docker 构建 Workflow

```yaml
# .github/workflows/docker.yml
name: Docker Build

on:
  push:
    branches: [main]
    tags: ['v*']

jobs:
  docker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          file: docker/Dockerfile.server
          push: ${{ github.event_name != 'pull_request' }}
          tags: codepod/server:latest
```

## 6. Docker 构建

### 6.1 Docker 目录结构

```
docker/
├── Dockerfile.agent              # Agent 镜像
├── Dockerfile.runner            # Runner 镜像
├── Dockerfile.server            # Server 镜像
├── docker-compose.yml           # 本地开发环境
├── docker-compose.prod.yml     # 生产环境
└── scripts/
    ├── build-agent.sh
    ├── build-runner.sh
    ├── build-server.sh
    └── build-all.sh
```

### 6.2 docker-compose.yml

```yaml
version: '3.8'

services:
  server:
    build:
      context: ..
      dockerfile: docker/Dockerfile.server
    ports:
      - "3000:3000"
    environment:
      - DB_PATH=/data/codepod.db
      - JWT_SECRET=secret
    volumes:
      - server-data:/data

  runner:
    build:
      context: ..
      dockerfile: docker/Dockerfile.runner
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    privileged: true

volumes:
  server-data:
```

## 7. 多语言 SDK 设计

### 7.1 Go SDK

```
libs/sdk-go/
├── client.go           # 客户端
├── sandbox.go         # Sandbox 操作
├── snapshot.go        # 快照操作
├── types.go          # 类型定义
└── go.mod
```

```go
package codepod

import "github.com/codepod/codepod/libs/sdk-go"

func main() {
    client := codepod.NewClient("https://api.example.com", "api-key")
    sandbox, err := client.CreateSandbox(&codepod.CreateOptions{
        Type:  "dev-container",
        Image: "python:3.11",
    })
}
```

### 7.2 Python SDK

```
libs/sdk-python/
├── codepod/
│   ├── __init__.py
│   ├── client.py
│   ├── sandbox.py
│   └── snapshot.py
├── pyproject.toml
└── setup.py
```

```python
from codepod import Client

client = Client("https://api.example.com", "api-key")
sandbox = client.create_sandbox(
    type="dev-container",
    image="python:3.11"
)
```

### 7.3 TypeScript SDK

```typescript
import { CodePod } from '@codepod/sdk';

const client = new CodePod({
  endpoint: 'https://api.example.com',
  apiKey: 'api-key'
});

const sandbox = await client.createSandbox({
  type: 'dev-container',
  image: 'python:3.11'
});
```

## 8. 依赖管理

### 8.1 Node.js Workspace

```json
{
  "name": "codepod",
  "private": true,
  "workspaces": [
    "apps/server",
    "apps/cli",
    "libs/sdk-typescript"
  ],
  "scripts": {
    "build": "npm run build --workspaces",
    "test": "npm run test --workspaces"
  }
}
```

### 8.2 Go Workspace

```go
// go.work
go 1.21

use (
	./apps/agent
	./apps/runner
	./libs/sdk-go
)

// apps/agent/go.mod
module github.com/codepod/codepod/apps/agent

go 1.21

require (
	github.com/codepod/codepod/libs/sdk-go v0.0.0
	github.com/docker/docker v24.0.0
)
```

## 9. 开发工作流

### 9.1 本地开发

```bash
# 1. 克隆代码
git clone https://github.com/codepod/codepod.git
cd codepod

# 2. 安装依赖
go work sync
go mod download
npm install

# 3. 生成 Protobuf
buf generate

# 4. 启动 Server (开发模式)
cd apps/server && npm run dev

# 5. 启动 Runner (开发模式)
cd apps/runner && go run cmd/main.go --dev

# 6. 使用 CLI
cd apps/cli && npm link
codepod list
```

### 9.2 Docker 开发

```bash
# 启动所有服务
cd docker
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止
docker-compose down
```

## 10. 发布流程

### 10.1 版本号

采用语义化版本 `vMAJOR.MINOR.PATCH`

### 10.2 发布步骤

```bash
# 1. 更新版本
# - 修改 apps/*/version
# - 修改 libs/*/version

# 2. 构建
make build

# 3. 测试
make test

# 4. Docker 构建并推送
make docker

# 5. Git 标签
git tag v1.0.0
git push origin v1.0.0
```

## 11. 文件命名约定

| 类型 | 规范 | 示例 |
|------|------|------|
| Go 源文件 | `snake_case.go` | `sandbox_handler.go` |
| TypeScript 源文件 | `kebab-case.ts` | `sandbox-handler.ts` |
| Python 源文件 | `snake_case.py` | `sandbox_handler.py` |
| 测试文件 | `*_test.go` / `*.test.ts` | `sandbox_test.go` |
| Protobuf | `snake_case.proto` | `runner.proto` |
| Docker | `Dockerfile.<service>` | `Dockerfile.agent` |
