# Runner 子系统设计

**版本**: v1.0
**日期**: 2026-02-17

## 1. 概述

### 1.1 Runner 定位

Runner 是 CodePod 的核心编排引擎，负责 Sandbox 容器的生命周期管理、Agent 注入、任务调度等。它是 Server 与 Sandbox 之间的桥梁。

### 1.2 核心职责

| 功能 | 描述 |
|------|------|
| **容器管理** | 创建、启动、停止、删除容器 |
| **Agent 注入** | 将 Agent 注入到 Sandbox 容器 |
| **任务调度** | 处理 Server 下发的任务 (创建/删除/快照等) |
| **资源管理** | Docker 镜像、卷、网络管理 |
| **状态上报** | 向 Server 报告 Runner 状态 |
| **弹性伸缩** | 支持水平扩展 (K8s) |

## 2. 架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                     Runner 进程                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │                   入口层                           │   │
│  │  - 命令行参数解析                                │   │
│  │  - 配置加载                                     │   │
│  │  - 信号处理                                     │   │
│  └─────────────────────┬───────────────────────────┘   │
│                        │                               │
│  ┌─────────────────────┴───────────────────────────┐   │
│  │                   核心层                         │   │
│  │                                              │   │
│  │  ┌─────────────────────────────────────────┐ │   │
│  │  │           Job Scheduler                │ │   │
│  │  │  - 任务队列管理                         │ │   │
│  │  │  - 任务状态机                          │ │   │
│  │  │  - 并发控制                            │ │   │
│  │  └─────────────────────────────────────────┘ │   │
│  │                                              │   │
│  └─────────────────────┬───────────────────────────┘   │
│                        │                               │
│  ┌─────────────────────┴───────────────────────────┐   │
│  │                   服务层                         │   │
│  │                                              │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐   │   │
│  │  │ Docker   │ │ Sandbox  │ │ Storage  │   │   │
│  │  │ Manager  │ │ Manager  │ │ Manager  │   │   │
│  │  └──────────┘ └──────────┘ └──────────┘   │   │
│  │                                              │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐   │   │
│  │  │ Network  │ │  Agent   │ │ Monitor   │   │   │
│  │  │ Manager  │ │ Manager  │ │           │   │   │
│  │  └──────────┘ └──────────┘ └──────────┘   │   │
│  │                                              │   │
│  └───────────────────────────────────────────────┘   │
│                        │                               │
│  ┌─────────────────────┴───────────────────────────┐   │
│  │                   通信层                         │   │
│  │                                              │   │
│  │  ┌─────────────────────────────────────────┐ │   │
│  │  │  gRPC Server (Server 通信)              │ │   │
│  │  │  - 任务接收                             │ │   │
│  │  │  - 状态上报                             │ │   │
│  │  └─────────────────────────────────────────┘ │   │
│  │                                              │   │
│  │  ┌─────────────────────────────────────────┐ │   │
│  │  │  HTTP Server (Agent 通信)              │ │   │
│  │  │  - Agent 注册                           │ │   │
│  │  │  - 状态接收                            │ │   │
│  │  └─────────────────────────────────────────┘ │   │
│  │                                              │   │
│  └───────────────────────────────────────────────┘   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 2.2 模块设计

#### 2.2.1 Job Scheduler

```go
// pkg/scheduler/scheduler.go

type Scheduler struct {
    queue    *JobQueue
    workers  int
    executor *Executor
}

type Job struct {
    ID        string
    Type      JobType
    Request   interface{}
    Status    JobStatus
    CreatedAt time.Time
    StartedAt time.Time
    FinishedAt time.Time
    Error     error
}

type JobType int
const (
    JobCreateSandbox JobType = iota
    JobDeleteSandbox
    JobCreateSnapshot
    JobRestoreSnapshot
    JobUpdateAgent
)

type JobStatus int
const (
    JobPending JobStatus = iota
    JobRunning
    JobSuccess
    JobFailed
)
```

**任务状态机:**

```
┌─────────┐     ┌─────────┐     ┌──────────┐     ┌─────────┐
│ pending │ ──► │ running │ ──► │ success  │ ──► │  done   │
└─────────┘     └─────────┘     └──────────┘     └─────────┘
     │               │                │
     │               │                ▼
     │               │          ┌─────────┐
     │               └────────►│ failed  │
     │                         └─────────┘
```

#### 2.2.2 Docker Manager

```go
// pkg/docker/manager.go

type DockerManager struct {
    client  *docker.Client
    network string
}

type ContainerConfig struct {
    Image        string
    Env          []string
    Volumes      []VolumeMount
    Ports        []PortBinding
    Resources    *ResourceRequirements
    SecurityOpt *SecurityOptions
}

type ResourceRequirements struct {
    Memory   string
    CPU      int64
    PidsLimit int64
}

type SecurityOptions struct {
    SeccompProfile string
    Capabilities   []string
    ReadOnlyRootFS bool
    UserNS         string
}
```

**功能：**
- 镜像拉取/构建
- 容器创建/启动/停止/删除
- 安全配置 (seccomp, capabilities)
- 资源限制 (memory, cpu, pids)

#### 2.2.3 Sandbox Manager

```go
// pkg/sandbox/manager.go

type SandboxManager struct {
    docker    *DockerManager
    agent    *AgentManager
    storage  *StorageManager
    network  *NetworkManager
}

type Sandbox struct {
    ID        string
    Name      string
    Status    SandboxStatus
    Image     string
    ContainerID string
    AgentPort int
    SSHPort   int
    CreatedAt time.Time
    ExpiresAt time.Time
    Config    *SandboxConfig
}

type SandboxConfig struct {
    Type      SandboxType
    Env       map[string]string
    EnvFrom   []EnvFrom
    Volumes   []Volume
    Resources *Resources
    Network   *NetworkConfig
    Idle      *IdleConfig
}

type SandboxType int
const (
    SandboxDevContainer SandboxType = iota
    SandboxCodeExecutor
)
```

**容器创建流程:**

```
┌─────────────────────────────────────────────────────────┐
│           Sandbox 创建流程                                    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. 任务验证                                             │
│     - 检查参数                                           │
│     - 检查镜像是否存在                                    │
│     - 检查资源配额                                        │
│                                                         │
│  2. 准备环境                                             │
│     - 拉取镜像 (如需要)                                  │
│     - 创建网络 (如需要)                                  │
│     - 创建卷 (如需要)                                    │
│                                                         │
│  3. 生成配置                                             │
│     - 生成 Agent 配置                                     │
│     - 生成环境变量                                       │
│     - 配置资源限制                                        │
│                                                         │
│  4. 创建容器                                             │
│     - Docker: create container                          │
│     - 设置 Entrypoint 为 Agent                          │
│     - 挂载卷                                             │
│     - 配置网络                                           │
│                                                         │
│  5. 启动容器                                             │
│     - Docker: start container                          │
│                                                         │
│  6. 等待 Agent 就绪                                      │
│     - 等待 Agent SSH 服务                               │
│     - 心跳检测                                           │
│                                                         │
│  7. 返回结果                                             │
│     - 返回 Sandbox 信息                                  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

#### 2.2.4 Agent Manager

```go
// pkg/agent/manager.go

type AgentManager struct {
    serverURL string
    version   string
}

type AgentConfig struct {
    ServerURL   string
    Token       string
    SandboxID   string
    SSHPort     int
    LogLevel    string
    EnvFile     string
    IdleTimeout time.Duration
}

// Agent 注入方式
type AgentInjectionMethod int
const (
    // 方式 1: 使用内置 Agent 的基础镜像
    InjectionBuiltIn AgentInjectionMethod = iota
    // 方式 2: 运行时注入 Agent 二进制
    InjectionRuntime
    // 方式 3: 通过 Volume 挂载 Agent
    InjectionVolume
)

// 构建 Agent 镜像
func (am *AgentManager) BuildAgentImage() error {
    // 1. 准备构建上下文
    // 2. 构建镜像
    // 3. 推送镜像
}
```

#### 2.2.5 Storage Manager

```go
// pkg/storage/manager.go

type StorageManager struct {
    docker *docker.Client
}

type Volume struct {
    Name        string
    Type        VolumeType
    Source      string
    Target      string
    ReadOnly    bool
}

type VolumeType int
const (
    VolumeBind VolumeType = iota
    VolumeNamed
    VolumeTmpfs
)

// 快照管理
type SnapshotManager struct {
    docker *docker.Client
}

func (sm *SnapshotManager) CreateSnapshot(sandboxID, name string) (*Snapshot, error) {
    // 1. 暂停容器
    // 2. Docker commit
    // 3. 保存元数据
    // 4. 恢复容器
}

func (sm *SnapshotManager) RestoreSnapshot(sandboxID, snapshotID string) error {
    // 1. 停止当前容器
    // 2. 从快照创建新容器
    // 3. 启动新容器
}
```

#### 2.2.6 Network Manager

```go
// pkg/network/manager.go

type NetworkManager struct {
    docker      *docker.Client
    networkName string
    dnsEnabled  bool
}

func (nm *NetworkManager) CreateNetwork(workspace string) (*Network, error) {
    return &Network{
        Name:   fmt.Sprintf("codepod-%s", workspace),
        Driver: "bridge",
        DNS:    nm.dnsEnabled,
    }, nil
}

type NetworkConfig struct {
    Mode     NetworkMode // isolated, shared, custom
    Workspace string
    DNS      *DNSConfig
}

type NetworkMode int
const (
    NetworkIsolated NetworkMode = iota
    NetworkShared
    NetworkCustom
)
```

#### 2.2.7 Monitor

```go
// pkg/monitor/monitor.go

type Monitor struct {
    runnerID    string
    interval   time.Duration
    lastReport time.Time
}

type RunnerStatus struct {
    RunnerID    string    `json:"runner_id"`
    Status      string    `json:"status"` // ready, busy, offline
    Version     string    `json:"version"`
    Uptime      int64     `json:"uptime"`
    Resources   Resources  `json:"resources"`
    JobQueue   JobQueueStatus `json:"job_queue"`
    Sandboxes   []SandboxStatus `json:"sandboxes"`
}

type Resources struct {
    CPU     float64 `json:"cpu"`     // percentage
    Memory  int64   `json:"memory"` // bytes
    Disk    int64   `json:"disk"`   // bytes
}

type JobQueueStatus struct {
    Pending   int `json:"pending"`
    Running   int `json:"running"`
    Completed int `json:"completed"`
    Failed    int `json:"failed"`
}
```

## 3. Runner 注册与识别

### 3.1 注册流程

```
┌─────────────────────────────────────────────────────────┐
│           Runner 注册流程                                    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. Runner 启动配置                                     │
│     - runner_id: "runner-001"                         │
│     - server_url: "grpc://server:8080"              │
│     - token: "runner_token_xxx"                      │
│     - resources: { cpu, memory, disk }                │
│                                                         │
│  2. 建立 gRPC 连接 (mTLS 双向认证)                    │
│                                                         │
│  3. 发送注册请求                                      │
│     Runner ──► Server: Register(RegisterRequest)       │
│                                                         │
│     RegisterRequest:                                   │
│     {                                                 │
│       runner_id: "runner-001",                        │
│       version: "1.0.0",                              │
│       resources: {                                     │
│         cpu: 4,                                       │
│         memory: "8Gi",                                │
│         disk: "100Gi"                                │
│       },                                              │
│       labels: {                                       │
│         region: "us-east-1",                         │
│         zone: "zone-a"                                │
│       }                                               │
│     }                                                 │
│                                                         │
│  4. Server 验证并记录                                  │
│     - 验证 token                                      │
│     - 分配 Runner ID                                  │
│     - 注册到 Runner 列表                               │
│                                                         │
│  5. 返回注册结果                                      │
│     Server ──► Runner: RegisterResponse                │
│                                                         │
│     RegisterResponse:                                  │
│     {                                                 │
│       success: true,                                  │
│       server_version: "1.0.0",                       │
│       agent_version: "1.0.0"                         │
│     }                                                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 3.2 Runner 识别机制

```go
// Server 端 Runner 注册表
type RunnerRegistry struct {
    mu       sync.RWMutex
    runners  map[string]*RunnerInfo
}

type RunnerInfo struct {
    ID          string            // 唯一标识
    Address     string            // gRPC 地址
    Status      RunnerStatus      // ready, busy, offline
    Resources   Resources         // CPU、内存、磁盘
    Labels      map[string]string // 标签 (region, zone 等)
    RegisteredAt time.Time
    LastHeartbeat time.Time
    Version     string
    SandboxCount int              // 当前 Sandbox 数量
}
```

### 3.3 Runner 选择算法

```go
// Server 选择合适的 Runner
func (s *Server) SelectRunner(req *CreateSandboxRequest) (*RunnerInfo, error) {
    // 1. 过滤满足资源要求的 Runner
    candidates := filterRunners(s.registry, func(r *RunnerInfo) bool {
        return r.Status == RunnerReady &&
               r.Resources.Memory >= req.Resources.Memory &&
               r.Resources.CPU >= req.Resources.CPU
    })

    // 2. 根据标签选择 (可选)
    if req.Labels != nil {
        candidates = filterByLabels(candidates, req.Labels)
    }

    // 3. 选择负载最低的 Runner (Least Connections)
    sort.Slice(candidates, func(i, j int) bool {
        return candidates[i].SandboxCount < candidates[j].SandboxCount
    })

    if len(candidates) == 0 {
        return nil, ErrNoAvailableRunner
    }

    return candidates[0], nil
}
```

### 3.4 心跳保活

```protobuf
// gRPC 心跳接口
service RunnerService {
    rpc Heartbeat(stream HeartbeatRequest) returns (stream HeartbeatResponse);
}

message HeartbeatRequest {
    string runner_id = 1;
    RunnerStatus status = 2;  // ready, busy
    Resources current_load = 3;
    int32 sandbox_count = 4;
}

message HeartbeatResponse {
    Command command = 1;  // update_agent, shutdown
}
```

**心跳流程：**
```
Runner ──每 30 秒──► Server: Heartbeat
                              │
                              ▼
                      更新最后活跃时间
                      更新资源使用情况
                              │
                              ▼
                      Runner ──返回──► HeartbeatResponse
```

### 3.5 Runner 状态管理

| 状态 | 描述 |
|------|------|
| **Ready** | 正常，可接收任务 |
| **Busy** | 忙碌中，可接收任务 |
| **Offline** | 离线，不分配任务 |

### 3.6 下线处理

| 场景 | 处理 |
|------|------|
| 心跳超时 (超过 2 分钟) | 标记为 offline，停止分配新任务 |
| Runner 主动断开 | 标记为 offline |
| Server 重启 | 重新连接并注册 |

## 4. 接口设计

### 3.1 命令行参数

```bash
runner [OPTIONS]

Options:
  --config FILE         配置文件路径
  --id ID              Runner ID
  --server-url URL     Server gRPC 地址
  --token TOKEN        认证 Token
  --docker-host HOST   Docker Host (default: unix:///var/run/docker.sock)
  --network DNS        DNS 域名后缀
  --log-level LEVEL   日志级别
  --version           显示版本
```

### 3.2 gRPC 接口 (与 Server 通信)

```protobuf
// proto/runner/runner.proto
syntax = "proto3";

package codepod.runner;

service RunnerService {
    // Runner 注册
    rpc Register(RegisterRequest) returns (RegisterResponse);

    // 心跳
    rpc Heartbeat(stream HeartbeatRequest) returns (stream HeartbeatResponse);

    // 任务处理
    rpc SubmitJob(Job) returns (JobResult);
    rpc GetJobStatus(JobId) returns (JobStatus);

    // 日志流
    rpc SubscribeLogs(LogRequest) returns (stream LogEntry);

    // Agent 管理
    rpc UpdateAgent(UpdateAgentRequest) returns (UpdateAgentResponse);

    // 资源查询
    rpc GetResources(ResourceRequest) returns (Resources);
}

message RegisterRequest {
    string runner_id = 1;
    string version = 2;
    Resources resources = 3;
}

message Job {
    string job_id = 1;
    JobType type = 2;
    bytes payload = 3;
    int32 priority = 4;
}

enum JobType {
    JOB_CREATE_SANDBOX = 0;
    JOB_DELETE_SANDBOX = 1;
    JOB_CREATE_SNAPSHOT = 2;
    JOB_RESTORE_SNAPSHOT = 3;
}
```

### 3.3 HTTP 接口 (与 Agent 通信)

| 方法 | 路径 | 描述 |
|------|------|------|
| `POST` | `/api/v1/agent/register` | Agent 注册 |
| `POST` | `/api/v1/agent/heartbeat` | Agent 心跳 |
| `POST` | `/api/v1/agent/status` | Agent 状态上报 |

## 5. 部署模式

### 4.1 Docker 部署 (DinD)

```dockerfile
# docker/Dockerfile.runner
FROM golang:1.21-alpine AS builder

WORKDIR /build
COPY apps/runner/go.mod apps/runner/go.sum ./
RUN go mod download

COPY apps/runner/ .
RUN CGO_ENABLED=1 go build -o runner ./cmd

FROM alpine:3.18

RUN apk add --no-cache docker-cli ca-certificates

WORKDIR /app
COPY --from=builder /build/runner /app/runner
COPY --from=builder /build/bin/agent /app/bin/agent

# 挂载 Docker socket
VOLUME /var/run/docker.sock

ENTRYPOINT ["/app/runner"]
```

### 4.2 Kubernetes 部署

```yaml
# k8s/runner-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: codepod-runner
spec:
  replicas: 3
  selector:
    matchLabels:
      app: codepod-runner
  template:
    metadata:
      labels:
        app: codepod-runner
    spec:
      containers:
      - name: runner
        image: codepod/runner:latest
        env:
        - name: SERVER_URL
          value: "grpc://codepod-server:8080"
        - name: DOCKER_HOST
          value: "tcp://docker-daemon:2375"
        volumeMounts:
        - name: docker-socket
          mountPath: /var/run/docker.sock
      volumes:
      - name: docker-socket
        hostPath:
          path: /var/run/docker.sock
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: codepod-runner-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: codepod-runner
  minReplicas: 2
  maxReplicas: 20
  metrics:
  - type: External
    external:
      metric:
        name: runner_job_queue_length
      target:
        type: AverageValue
        averageValue: "10"
```

## 6. 安全设计

### 5.1 安全配置

```go
// 容器安全配置
func GetSecurityOptions() *container.SecurityOpt {
    return &container.SecurityOpt{
        // seccomp 限制
        SeccompProfile: "codepod-seccomp.json",
        // 移除所有 capabilities
        Capabilities: []string{"CHOWN", "DAC_OVERRIDE", "FSETID", "FOWNER", "MKNOD", "NET_RAW", "SETGID", "SETUID", "SETFCAP"},
        // 只读根文件系统
        ReadonlyRootfs: true,
    }
}
```

### 5.2 网络隔离

```go
// 网络隔离配置
func GetNetworkOptions() *container.NetworkMode {
    return &container.NetworkMode{
        // 使用自定义网络
        Network: "codepod-network",
        // 可选: 禁用网络
        // Mode: "none",
    }
}
```

## 7. 目录结构

```
apps/runner/
├── cmd/
│   └── main.go                 # 入口
│
├── pkg/
│   ├── scheduler/              # 任务调度
│   │   ├── scheduler.go
│   │   ├── queue.go
│   │   └── worker.go
│   │
│   ├── docker/                 # Docker 操作
│   │   ├── client.go
│   │   ├── container.go
│   │   ├── image.go
│   │   └── network.go
│   │
│   ├── sandbox/               # Sandbox 管理
│   │   ├── manager.go
│   │   ├── create.go
│   │   └── delete.go
│   │
│   ├── agent/                 # Agent 管理
│   │   ├── manager.go
│   │   └── config.go
│   │
│   ├── storage/               # 存储管理
│   │   ├── manager.go
│   │   ├── volume.go
│   │   └── snapshot.go
│   │
│   ├── network/               # 网络管理
│   │   ├── manager.go
│   │   └── dns.go
│   │
│   ├── monitor/               # 监控
│   │   └── monitor.go
│   │
│   └── config/                # 配置
│       └── config.go
│
├── internal/
│   └── runner/
│       ├── runner.go          # 核心逻辑
│       ├── grpc.go            # gRPC 服务
│       └── http.go            # HTTP 服务
│
├── go.mod
└── go.sum
```

## 8. 配置示例

```yaml
# /etc/codepod/runner.yaml
server:
  url: "grpc://codepod-server:8080"
  token: "${RUNNER_TOKEN}"

docker:
  host: "unix:///var/run/docker.sock"
  registry: "docker.io"
  max_concurrent_builds: 3

network:
  name: "codepod-network"
  dns_enabled: true
  dns_suffix: "codepod.local"

sandbox:
  default_timeout: 24h
  max_sandboxes: 10
  idle_timeout: 30m

security:
  seccomp_profile: "/etc/codepod/seccomp.json"
  readonly_rootfs: true
  drop_capabilities:
    - NET_ADMIN
    - SYS_ADMIN
    - SYS_MODULE

logging:
  level: info
  format: json
```

## 9. 依赖

```go
// apps/runner/go.mod
module github.com/codepod/codepod/apps/runner

go 1.21

require (
    github.com/codepod/codepod/libs/sdk-go v0.0.0
    github.com/docker/docker v24.0.0
    github.com/docker/cli v24.0.0
    google.golang.org/grpc v1.58.0
    google.golang.org/protobuf v1.31.0
)
```
