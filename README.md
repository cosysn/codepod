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

### 构建 Release

```bash
# 克隆项目
git clone https://github.com/codepod/codepod.git
cd codepod

# 创建 git tag
git tag v0.1.0
git push origin v0.1.0

# 构建 release（自动打包并构建 Docker 镜像）
make release
```

构建产物位于 `releases/v0.1.0/` 目录：

```
releases/v0.1.0/
├── codepod-cli-v0.1.0-linux-amd64.tar.gz     # CLI
├── codepod-server-v0.1.0-linux-amd64.tar.gz # Server
├── codepod-agent-v0.1.0-linux-amd64.tar.gz   # Agent
├── codepod-runner-v0.1.0-linux-amd64.tar.gz  # Runner
├── docker/
│   ├── codepod-server-v0.1.0.tar            # Server Docker 镜像
│   └── codepod-runner-v0.1.0.tar            # Runner Docker 镜像
├── install.sh                                # Linux 安装脚本
└── install.bat                               # Windows 安装脚本
```

### 安装

```bash
# 解压 release 包
cd releases/v0.1.0

# 安装（需要 sudo）
sudo ./install.sh v0.1.0
```

安装选项：

```bash
# 自定义安装路径
INSTALL_PREFIX=/opt/codepod ./install.sh v0.1.0

# 跳过 Docker 镜像导入
IMPORT_DOCKER=false ./install.sh v0.1.0

# 自定义数据目录
DATA_DIR=/var/lib/codepod ./install.sh v0.1.0
```

安装目录结构：

```
/usr/local/bin/          # 可执行文件
├── codepod              # CLI
├── codepod-server       # Server 启动脚本
├── codepod-agent        # Agent 二进制
└── codepod-runner       # Runner 二进制

/usr/local/lib/
├── codepod-cli/         # CLI 库文件
└── codepod-server/      # Server 库文件

~/.codepod/
└── config.yaml          # 配置文件
```

### 部署

使用 Docker Compose 部署 Server 和 Runner：

```bash
# 加载 Docker 镜像
docker load -i docker/codepod-server-v0.1.0.tar
docker load -i docker/codepod-runner-v0.1.0.tar

# 启动服务
docker run -d \
  --name codepod-server \
  -p 8080:8080 \
  -p 8443:8443 \
  -e CODEPOD_REGISTRY_URL=http://registry:5000 \
  codepod/server:v0.1.0

docker run -d \
  --name codepod-runner \
  --privileged \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e CODEPOD_SERVER_URL=http://server:8080 \
  codepod/runner:v0.1.0
```

### 卸载

```bash
# 卸载 CodePod
sudo ./install.sh uninstall

# 或者
sudo ./install.sh --uninstall
```

卸载时会有交互提示询问是否删除配置文件和 Docker 镜像。

## 开发模式

### 前置要求

- Docker 20.10+
- Go 1.21+
- Node.js 20+

### 本地开发

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
cd sandbox/server && npm run dev
```

### 使用 Docker Compose 开发

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
