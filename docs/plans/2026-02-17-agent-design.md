# Agent 子系统设计

**版本**: v1.0
**日期**: 2026-02-17

## 1. 概述

### 1.1 Agent 定位

Agent 是运行在 Sandbox 容器内的核心进程 (PID 1)，负责提供 SSH 访问、命令执行、端口转发等功能，是用户与 Sandbox 交互的入口。

### 1.2 核心职责

| 功能 | 描述 |
|------|------|
| **SSH Server** | 提供 SSH 访问，支持交互式 Shell 和命令执行 |
| **进程管理** | 作为 PID 1，管理子进程、信号转发、资源限制 |
| **命令执行** | 执行用户命令，支持管道、重定向、交互式 Shell |
| **端口转发** | 支持本地、远程、动态端口转发 |
| **文件管理** | SFTP 文件上传下载、目录操作 |
| **状态上报** | 心跳、资源使用、进程列表上报给 Runner |
| **自动更新** | 版本检测、热更新、回滚 |

## 2. 架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                    Agent 进程                             │
│                        PID 1                              │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │                   入口层                          │   │
│  │  - 命令行参数解析                                │   │
│  │  - 配置加载                                     │   │
│  │  - 信号处理                                     │   │
│  └─────────────────────┬───────────────────────────┘   │
│                        │                                 │
│  ┌─────────────────────┴───────────────────────────┐   │
│  │                   核心层                          │   │
│  │                                                  │   │
│  │  ┌─────────────────────────────────────────┐   │   │
│  │  │           Session Manager                │   │   │
│  │  │  - 交互式会话管理                       │   │   │
│  │  │  - PTY 管理                             │   │   │
│  │  │  - 会话生命周期                         │   │   │
│  │  └─────────────────────────────────────────┘   │   │
│  │                                                  │   │
│  │  ┌─────────────────────────────────────────┐   │   │
│  │  │           Command Executor               │   │   │
│  │  │  - Shell 执行器 (bash/sh)               │   │   │
│  │  │  - 直接执行器 (exec)                    │   │   │
│  │  │  - 管道处理                             │   │   │
│  │  └─────────────────────────────────────────┘   │   │
│  │                                                  │   │
│  │  ┌─────────────────────────────────────────┐   │   │
│  │  │           Process Manager                │   │   │
│  │  │  - 子进程管理 (fork/wait)               │   │   │
│  │  │  - 进程组管理                           │   │   │
│  │  │  - 信号转发                             │   │   │
│  │  │  - Cgroup 资源限制                     │   │   │
│  │  └─────────────────────────────────────────┘   │   │
│  │                                                  │   │
│  └─────────────────────┬───────────────────────────┘   │
│                        │                                 │
│  ┌─────────────────────┴───────────────────────────┐   │
│  │                   服务层                          │   │
│  │                                                  │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐       │   │
│  │  │ SSH Svr │ │ SFTP Svr │ │ HTTP API │       │   │
│  │  └──────────┘ └──────────┘ └──────────┘       │   │
│  │                                                  │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐       │   │
│  │  │  Tunnel  │ │ Reporter │ │ Updater │       │   │
│  │  │  Manager │ │          │ │          │       │   │
│  │  └──────────┘ └──────────┘ └──────────┘       │   │
│  │                                                  │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 2.2 模块设计

#### 2.2.1 SSH Server

```go
// pkg/ssh/server.go

type SSHServer struct {
    config   *SSHConfig
    hostKey  []byte
    auth     *Authenticator
    sessions *SessionManager
}

// SSH 配置
type SSHConfig struct {
    Port         int    // 默认 22
    HostKeys     []string
    MaxSessions  int    // 最大并发会话数
    IdleTimeout  time.Duration
    Banner       string // 登录欢迎语
}

// 认证方式
type Authenticator struct {
    passwordAuth  bool
    publicKeyAuth bool
    tokenAuth     bool
}
```

**功能：**
- 支持密码认证、Token 认证、公钥认证
- 支持交互式 Shell 和单命令执行
- 支持端口转发
- 支持 X11 转发 (可选)
- 支持 Keep-alive

#### 2.2.2 Session Manager

```go
// pkg/ssh/session.go

type SessionManager struct {
    mu       sync.RWMutex
    sessions map[string]*Session
    pty     *PTYManager
}

type Session struct {
    ID          string
    Type        SessionType // interactive, exec, subsystem
    User        string
    PTY         *PTY
    Command     string
    StartTime   time.Time
    env         map[string]string
    workingDir  string
}

type PTY struct {
    Master *os.File
    Slave  *os.File
    Window *WindowSize
}
```

**功能：**
- 管理多个并发会话
- PTY 分配和窗口大小管理
- 会话生命周期管理

#### 2.2.3 Command Executor

```go
// pkg/exec/executor.go

type Executor struct {
    shellPath string // /bin/bash, /bin/sh
    env       map[string]string
}

type ExecRequest struct {
    Command string
    Env     map[string]string
    Dir     string
    TTY     bool
    Width   int
    Height  int
}

type ExecResult struct {
    ExitCode int
    Stdout   string
    Stderr   string
    Duration time.Duration
}
```

**执行模式：**

| 模式 | 描述 | 用途 |
|------|------|------|
| Shell | 通过 Shell 执行 | 交互式命令、管道、重定向 |
| Direct | 直接执行命令 | 快速执行、无 Shell 特性 |
| Subsystem | SFTP 等子系统 | 文件传输 |

#### 2.2.4 Process Manager

```go
// pkg/process/manager.go

type ProcessManager struct {
    reaper *Reaper
    limits *ResourceLimits
}

type ResourceLimits struct {
    MaxProcesses int
    MaxMemory   int64  // bytes
    MaxCPU      int    // percentage
}

// 作为 PID 1 的职责:
func (pm *ProcessManager) HandleSignal(sig syscall.Signal) {
    // 转发信号给所有子进程
    // 回收僵尸进程
}
```

**功能：**
- 回收僵尸进程 (wait/waitpid)
- 信号转发 (SIGTERM, SIGKILL, SIGINT 等)
- Cgroup 资源限制
- 进程数限制

#### 2.2.5 Tunnel Manager

```go
// pkg/tunnel/manager.go

type TunnelManager struct {
    mu      sync.RWMutex
    tunnels map[string]*Tunnel
}

type Tunnel struct {
    ID       string
    Type     TunnelType // local, remote, dynamic
    BindAddr string
    Target   string
    Listener net.Listener
    Conn     net.Conn
}

type TunnelType int
const (
    TunnelLocal   TunnelType = iota  // -L 本地端口转发
    TunnelRemote                      // -R 远程端口转发
    TunnelDynamic                    // -D 动态端口转发 (SOCKS)
)
```

**端口转发示例：**

```bash
# 本地端口转发
ssh -L 8080:localhost:3000 user@sandbox

# 远程端口转发
ssh -R 8080:localhost:3000 user@sandbox

# 动态端口转发 (SOCKS 代理)
ssh -D 1080 user@sandbox
```

#### 2.2.6 Reporter (状态上报)

```go
// pkg/reporter/reporter.go

type Reporter struct {
    serverAddr string
    interval   time.Duration
    sandboxID  string
}

type AgentStatus struct {
    SandboxID   string         `json:"sandbox_id"`
    Version     string         `json:"version"`
    Uptime      int64         `json:"uptime"`
    Resources   ResourceUsage  `json:"resources"`
    Processes   []ProcessInfo `json:"processes"`
    Connections []ConnInfo    `json:"connections"`
}

type ResourceUsage struct {
    CPU    float64 `json:"cpu"`
    Memory Memory  `json:"memory"`
    Disk   Disk    `json:"disk"`
}
```

**上报内容：**
- 心跳 (每 30 秒)
- 资源使用 (CPU/Memory/Disk)
- 进程列表
- SSH 连接状态

#### 2.2.7 Auto Updater

```go
// pkg/update/updater.go

type Updater struct {
    serverAddr string
    version    string
}

type UpdateInfo struct {
    Version   string   `json:"version"`
    URL       string   `json:"url"`
    Checksum  string   `json:"checksum"`
    Signature string   `json:"signature"`
}
```

**更新流程：**
1. 心跳时检查版本
2. 发现新版本，下载更新包
3. 验证签名
4. 热更新或重启

## 3. 接口设计

### 3.1 命令行参数

```bash
agent [OPTIONS]

Options:
  --config FILE          配置文件路径 (default: /etc/codepod/agent.yaml)
  --host-key PATH        SSH 主机密钥
  --port PORT            SSH 端口 (default: 22)
  --server-url URL       Runner Server URL
  --token TOKEN          认证 Token
  --env ENV_FILE         环境变量文件 (default: /etc/codepod/env)
  --log-level LEVEL      日志级别 (debug/info/warn/error)
  --version              显示版本
```

### 3.2 环境变量注入

环境变量由 Server 注入，支持两种方式：

#### 3.2.1 环境变量来源

```
┌─────────────────────────────────────────────────────────┐
│              环境变量注入流程                               │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Server (创建 Sandbox 请求)                              │
│  ┌─────────────────────────────────────────────────┐   │
│  │  {                                              │   │
│  │    "env": {                                    │   │
│  │      "DATABASE_URL": "postgres://...",         │   │
│  │      "API_KEY": "sk-xxx",                     │   │
│  │      "DEBUG": "true"                          │   │
│  │    },                                           │   │
│  │    "envFrom": [                               │   │
│  │      { "secret": "my-secret" },               │   │
│  │      { "configmap": "app-config" }            │   │
│  │    ]                                            │   │
│  │  }                                              │   │
│  └─────────────────────┬───────────────────────────┘   │
│                        │                                 │
│                        │ Runner                          │
│                        ▼                                 │
│  ┌─────────────────────────────────────────────────┐   │
│  │  写入环境变量文件                                │   │
│  │  /etc/codepod/env                              │   │
│  │  ─────────────────────                         │   │
│  │  DATABASE_URL=postgres://...                    │   │
│  │  API_KEY=sk-xxx                                │   │
│  │  DEBUG=true                                    │   │
│  └─────────────────────┬───────────────────────────┘   │
│                        │                                 │
│                        │ 容器启动                        │
│                        ▼                                 │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Agent 读取环境变量                             │   │
│  │  export $(cat /etc/codepod/env | xargs)       │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

#### 3.2.2 环境变量类型

| 类型 | 描述 | 示例 |
|------|------|------|
| **内联变量** | 直接在请求中传递 | `"DATABASE_URL": "postgres://..."` |
| **Secret** | 从密钥管理服务获取 | API Key、密码、Token |
| **ConfigMap** | 从配置中心获取 | 应用配置 |

#### 3.2.3 敏感变量标记

```yaml
# 创建 Sandbox 请求
{
  "env": {
    "DEBUG": "true",
    "DATABASE_URL": "postgres://user:pass@host/db"
  },
  "envFrom": [
    {
      "type": "secret",
      "name": "api-credentials",
      "vars": ["API_KEY", "API_SECRET"]
    }
  ],
  "sensitive": ["API_KEY", "API_SECRET", "DATABASE_URL"]
}
```

#### 3.2.4 环境变量处理

```go
// pkg/config/env.go

type EnvManager struct {
    envFile  string
    secrets  map[string]string
    configmap map[string]string
}

type EnvConfig struct {
    // 内联变量
    Inline map[string]string `json:"env,omitempty"`

    // 从 Secret 引用
    EnvFrom []EnvFromSource `json:"envFrom,omitempty"`

    // 敏感变量列表 (不记录日志)
    Sensitive []string `json:"sensitive,omitempty"`
}

type EnvFromSource struct {
    Type     string   `json:"type"` // "secret" | "configmap"
    Name     string   `json:"name"`
    Vars     []string `json:"vars,omitempty"` // 要引入的变量名
}

// 加载环境变量
func (e *EnvManager) Load() error {
    // 1. 读取 env 文件
    // 2. 解析 key=value 格式
    // 3. 标记敏感变量 (不输出到日志)
}

// 安全处理
func (e *EnvManager) Get(key string) string {
    val := os.Getenv(key)
    if e.isSensitive(key) {
        return "***REDACTED***"
    }
    return val
}
```

#### 3.2.5 安全考虑

| 措施 | 描述 |
|------|------|
| **文件权限** | env 文件权限 0600，仅 root 可读 |
| **日志脱敏** | 敏感变量在日志中显示为 `***REDACTED***` |
| **进程环境** | 仅传递给用户命令，不继承到 Agent 进程 |
| **内存安全** | 敏感变量使用后立即清理 |

#### 3.2.6 执行时环境变量

```go
// 执行命令时传递环境变量
func (ex *Executor) Exec(ctx context.Context, req *ExecRequest) *ExecResult {
    // 1. 加载基础环境变量
    env := loadEnvFile("/etc/codepod/env")

    // 2. 添加请求中的环境变量
    for k, v := range req.Env {
        env[k] = v
    }

    // 3. 执行命令
    cmd := exec.CommandContext(ctx, req.Command...)
    cmd.Env = toEnvSlice(env)
    cmd.Dir = req.Dir

    return runCmd(cmd)
}
```

### 3.3 HTTP API (Agent 内置)

| 方法 | 路径 | 描述 |
|------|------|------|
| `GET` | `/health` | 健康检查 |
| `GET` | `/status` | 获取状态 |
| `POST` | `/exec` | 执行命令 |
| `GET` | `/processes` | 进程列表 |
| `POST` | `/tunnel` | 创建端口转发 |
| `DELETE` | `/tunnel/:id` | 删除端口转发 |

### 3.3 gRPC 接口 (与 Runner 通信)

```protobuf
// proto/agent/agent.proto
syntax = "proto3";

package codepod.agent;

service AgentService {
    // 心跳
    rpc Heartbeat(HeartbeatRequest) returns (HeartbeatResponse);

    // 状态上报
    rpc ReportStatus(stream StatusReport) returns (stream ControlCommand);

    // 日志上传
    rpc UploadLogs(stream LogData) returns (Empty);
}

message HeartbeatRequest {
    string sandbox_id = 1;
    string version = 2;
}

message StatusReport {
    ResourceUsage resources = 1;
    repeated ProcessInfo processes = 2;
    repeated ConnectionInfo connections = 3;
}

message ControlCommand {
    enum CmdType {
        UPDATE = 0;
        SHUTDOWN = 1;
        RESTART = 2;
        UPDATE_CONFIG = 3;
    }
    CmdType type = 1;
    bytes payload = 2;
}
```

## 4. 认证设计

### 4.1 认证方式

| 方式 | 描述 | 配置 |
|------|------|------|
| **Token** | 临时 Token，来自 API | 默认启用 |
| **公钥** | authorized_keys | 可选配置 |
| **密码** | 临时密码 | 禁用 (安全) |

### 4.2 Token 认证流程

```
1. 用户通过 CLI/SDK 获取 SSH Token
   CLI ──HTTP──► Server ──gRPC──► Runner
                                    │
                                    ▼
                              返回 Token

2. SSH 连接时 Token 验证
   SSH Client ──► Agent: password = Token
                  │
                  └──► 验证 Token 有效性
                      - 检查过期时间
                      - 检查 Sandbox 归属
                      - 验证通过，启动 Shell
```

## 5. 安全设计

### 5.1 限制措施

| 措施 | 描述 |
|------|------|
| **只读 /bin /usr** | 限制写入系统目录 |
| **禁止 root 登录** | 可选，允许特定用户 |
| **命令白名单** | 限制可执行命令 |
| **网络隔离** | 独立网络命名空间 |
| **资源限制** | Cgroup 限制 CPU/内存 |

### 5.2 安全配置示例

```yaml
# /etc/codepod/agent.yaml
security:
  # 禁止的命令
  disabled_commands:
    - rm -rf /
    - dd if=/dev/zero

  # 只读目录
  readonly_paths:
    - /bin
    - /usr
    - /lib

  # 资源限制
  limits:
    max_processes: 100
    max_memory: 2GB
    max_cpu: 50%

  # 网络
  network:
    mode: isolated  # isolated / shared
```

## 6. 目录结构

```
apps/agent/
├── cmd/
│   └── main.go                 # 入口
│
├── pkg/
│   ├── ssh/                   # SSH 服务器
│   │   ├── server.go
│   │   ├── session.go
│   │   ├── pty.go
│   │   ├── auth.go
│   │   └── crypto.go
│   │
│   ├── exec/                  # 命令执行
│   │   ├── executor.go
│   │   ├── shell.go
│   │   └──管道.go
│   │
│   ├── process/               # 进程管理
│   │   ├── manager.go
│   │   ├── reaper.go
│   │   └── limits.go
│   │
│   ├── tunnel/                # 端口转发
│   │   ├── manager.go
│   │   ├── local.go
│   │   ├── remote.go
│   │   └── dynamic.go
│   │
│   ├── reporter/              # 状态上报
│   │   ├── reporter.go
│   │   └── status.go
│   │
│   ├── update/                # 自动更新
│   │   ├── updater.go
│   │   └── rollback.go
│   │
│   └── config/                # 配置
│       └── config.go
│
├── internal/
│   └── agent/
│       ├── agent.go           # 核心逻辑
│       └── signal.go          # 信号处理
│
├── go.mod
└── go.sum
```

## 7. 依赖

```go
// apps/agent/go.mod
module github.com/codepod/codepod/apps/agent

go 1.21

require (
    github.com/codepod/codepod/libs/sdk-go v0.0.0
    golang.org/x/crypto v0.17.0  // SSH
    github.com/docker/docker v24.0.0
    google.golang.org/grpc v1.58.0
    google.golang.org/protobuf v1.31.0
)
```

## 8. 构建

```dockerfile
# docker/Dockerfile.agent
FROM golang:1.21-alpine AS builder

WORKDIR /build
COPY apps/agent/go.mod apps/agent/go.sum ./
RUN go mod download

COPY apps/agent/ .
RUN CGO_ENABLED=0 GOOS=linux go build -o agent ./cmd

FROM alpine:3.18

RUN apk add --no-cache openssh-server ca-certificates tzdata

WORKDIR /app
COPY --from=builder /build/agent /app/agent

# 创建非 root 用户
RUN adduser -D -s /bin/sh codepod

EXPOSE 22

ENTRYPOINT ["/app/agent"]
```

## 9. 配置示例

```yaml
# /etc/codepod/agent.yaml
server:
  url: "http://runner:8080"
  token: "${AGENT_TOKEN}"

ssh:
  port: 22
  host_keys:
    - /etc/ssh/ssh_host_rsa_key
    - /etc/ssh/ssh_host_ed25519_key
  max_sessions: 10
  idle_timeout: 30m
  banner: "Welcome to CodePod Sandbox"

logging:
  level: info
  format: json

security:
  readonly_paths:
    - /bin
    - /usr
    - /lib
    - /lib64
  disabled_commands:
    - rm -rf /
    - mkfs
    - dd if=/dev/zero

limits:
  max_processes: 100
  max_memory: 2GB
  max_cpu: 50
```

## 10. 测试

```go
// pkg/ssh/server_test.go
func TestSSHServer_Auth(t *testing.T) {
    // 测试 Token 认证
    // 测试公钥认证
    // 测试错误密码
}

// pkg/exec/executor_test.go
func TestExecutor_Shell(t *testing.T) {
    // 测试命令执行
    // 测试管道
    // 测试重定向
}

// pkg/process/manager_test.go
func TestProcessManager_Reap(t *testing.T) {
    // 测试僵尸进程回收
    // 测试信号转发
}
```
