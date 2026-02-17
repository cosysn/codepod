# CodePod

一个安全的沙盒平台，用于隔离的开发环境和 AI Agent 执行环境。

## 特性

- **安全隔离**: 基于 Docker 的安全沙盒环境
- **多种执行环境**: 支持 Python、Node.js、Go 等多种语言
- **SSH 访问**: 支持 VSCode Remote SSH 开发
- **快照管理**: 支持创建、恢复快照
- **多语言 SDK**: 支持 Go、Python、TypeScript
- **弹性伸缩**: 支持 Runner 弹性伸缩

## 快速开始

### 前置要求

- Docker 20.10+
- Go 1.21+
- Node.js 20+
- Docker Compose (可选)

### 安装

```bash
# 克隆项目
git clone https://github.com/codepod/codepod.git
cd codepod

# 安装依赖
go work sync
npm install

# 构建
make build

# 运行 (开发模式)
cd apps/server && npm run dev
```

### 使用 Docker Compose

```bash
cd docker
docker-compose up -d
```

## 使用方法

### CLI

```bash
# 配置 Server 端点
codepod config set endpoint http://localhost:3000
codepod config set api-key <your-api-key>

# 创建 Sandbox
codepod create --type dev-container --image python:3.11

# 列出 Sandbox
codepod list

# SSH 连接
codepod ssh <sandbox-id>

# 删除 Sandbox
codepod delete <sandbox-id>
```

### SDK

#### TypeScript

```typescript
import { CodePod } from '@codepod/sdk';

const client = new CodePod({
  endpoint: 'http://localhost:3000',
  apiKey: 'your-api-key'
});

const sandbox = await client.createSandbox({
  type: 'dev-container',
  image: 'python:3.11'
});
```

#### Python

```python
from codepod import Client

client = Client('http://localhost:3000', 'your-api-key')
sandbox = client.create_sandbox(
    type='dev-container',
    image='python:3.11'
)
```

#### Go

```go
import "github.com/codepod/codepod/libs/sdk-go"

client := codepod.NewClient("http://localhost:3000", "your-api-key")
sandbox, err := client.CreateSandbox(&codepod.CreateOptions{
    Type:  "dev-container",
    Image: "python:3.11",
})
```

## 项目结构

```
codepod/
├── apps/           # 核心应用
│   ├── agent/     # Agent (Go)
│   ├── runner/    # Runner (Go)
│   ├── server/    # Server (Node.js)
│   └── cli/      # CLI (Node.js)
│
├── libs/          # 多语言 SDK
│   ├── sdk-go/
│   ├── sdk-python/
│   └── sdk-typescript/
│
├── images/        # 内置镜像
│   ├── python/
│   ├── nodejs/
│   └── go/
│
├── docker/        # Docker 配置
└── .github/      # GitHub Actions
```

## 文档

- [架构设计](docs/plans/2026-02-17-codepod-architecture.md)
- [代码结构](docs/plans/2026-02-17-codepod-code-structure.md)

## 许可证

MIT
