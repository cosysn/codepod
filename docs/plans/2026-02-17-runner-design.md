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

## 4. Job 管理

### 4.1 Job 超时处理

```go
type JobConfig struct {
    Timeout       time.Duration  // Job 执行超时时间
    TimeoutAction TimeoutAction // 超时后动作 (cancel, force_stop)
}

type TimeoutAction int
const (
    TimeoutCancel TimeoutAction = iota  // 取消 Job
    TimeoutForceStop                   // 强制停止
    TimeoutNotify                      // 通知 Server
)

// Job 超时处理流程
func (js *JobScheduler) handleJobTimeout(job *Job) {
    // 1. 停止当前 Job
    js.stopJob(job)

    // 2. 清理资源
    js.cleanupJob(job)

    // 3. 更新状态
    job.Status = JobFailed
    job.Error = ErrJobTimeout

    // 4. 通知 Server
    js.server.NotifyJobFailed(job.ID, ErrJobTimeout)
}
```

### 4.2 Job 重试机制

```go
type RetryPolicy struct {
    MaxRetries  int           // 最大重试次数
    InitialDelay time.Duration // 初始延迟
    MaxDelay    time.Duration // 最大延迟
    Backoff     BackoffStrategy // 退避策略
}

type BackoffStrategy int
const (
    ExponentialBackoff BackoffStrategy = iota  // 指数退避
    LinearBackoff                              // 线性退避
    FixedBackoff                               // 固定延迟
)

// 重试示例
retry := &RetryPolicy{
    MaxRetries:  3,
    InitialDelay: 1 * time.Second,
    MaxDelay:    30 * time.Second,
    Backoff:     ExponentialBackoff,
}
```

### 4.3 Job 优先级

```go
type JobPriority int
const (
    PriorityLow JobPriority = iota
    PriorityNormal
    PriorityHigh
    PriorityCritical
)

// 优先级队列
type PriorityJobQueue struct {
    queues map[JobPriority]*JobQueue
}

func (q *PriorityJobQueue) Enqueue(job *Job) {
    q.queues[job.Priority].Enqueue(job)
}

func (q *PriorityJobQueue) Dequeue() *Job {
    // 从高优先级到低优先级
    for p := PriorityCritical; p >= PriorityLow; p-- {
        if job := q.queues[p].Dequeue(); job != nil {
            return job
        }
    }
    return nil
}
```

### 4.4 Job 并发控制

```go
type ConcurrencyConfig struct {
    MaxConcurrentJobs    int           // 最大并发 Job 数
    MaxConcurrentPerUser int          // 单用户最大并发
    QueueSize         int           // 队列大小
}

func (js *JobScheduler) canAcceptJob(job *Job) bool {
    // 检查全局并发
    if js.runningJobs >= js.config.MaxConcurrentJobs {
        return false
    }

    // 检查单用户并发
    userJobs := js.getUserRunningJobs(job.Owner)
    if userJobs >= js.config.MaxConcurrentPerUser {
        return false
    }

    return true
}
```

## 5. 资源管理

### 5.1 资源配额

```go
type Quota struct {
    MaxSandboxes    int   // 最大 Sandbox 数
    MaxCPU         int64 // CPU 核心数
    MaxMemory      int64 // 内存 (bytes)
    MaxDisk        int64 // 磁盘 (bytes)
    MaxSandboxAge  time.Duration // 最大运行时长
}

type UserQuota struct {
    UserID string
    Quota   Quota
    Used    Quota
}

// 资源检查
func (qm *QuotaManager) CheckQuota(userID string, req *CreateSandboxRequest) error {
    quota := qm.GetUserQuota(userID)

    if quota.Used.CPU+req.CPU > quota.MaxCPU {
        return ErrCPUQuotaExceeded
    }

    if quota.Used.Memory+req.Memory > quota.MaxMemory {
        return ErrMemoryQuotaExceeded
    }

    if quota.Used.Sandboxes+1 > quota.MaxSandboxes {
        return ErrSandboxQuotaExceeded
    }

    return nil
}
```

### 5.2 公平调度

```go
type FairScheduler struct {
    userWeight map[string]float64
}

func (fs *FairScheduler) SelectJob() *Job {
    // 计算每个用户的公平份额
    // 选择使用资源最少的用户

    users := fs.getActiveUsers()
    for _, user := range users {
        jobs := fs.getUserJobs(user)
        if len(jobs) > 0 {
            return fs.selectByWeight(jobs, fs.userWeight[user])
        }
    }
    return nil
}
```

### 5.3 资源清理

```go
func (js *JobScheduler) cleanupJob(job *Job) {
    // 1. 停止容器
    if job.ContainerID != "" {
        js.docker.StopContainer(job.ContainerID)
    }

    // 2. 删除网络
    if job.NetworkID != "" {
        js.docker.RemoveNetwork(job.NetworkID)
    }

    // 3. 删除卷 (可选，保留数据)
    if !job.KeepVolumes {
        for _, vol := range job.Volumes {
            js.docker.RemoveVolume(vol.Name)
        }
    }

    // 4. 清理临时文件
    js.cleanupTempFiles(job.ID)
}
```

## 6. Sandbox 生命周期

### 6.1 状态持久化

```go
type SandboxStore interface {
    Save(sandbox *Sandbox) error
    Get(id string) (*Sandbox, error)
    Delete(id string) error
    List() ([]*Sandbox, error)
    UpdateStatus(id string, status SandboxStatus) error
}

// 持久化到 SQLite
type SQLiteStore struct {
    db *sql.DB
}

func (s *SandboxStore) Save(sandbox *Sandbox) error {
    _, err := s.db.Exec(`
        INSERT INTO sandboxes (id, name, status, container_id, ...)
        VALUES (?, ?, ?, ...)`,
        sandbox.ID, sandbox.Name, sandbox.Status, sandbox.ContainerID)
    return err
}
```

### 6.2 Sandbox 迁移

```go
type MigrationManager struct {
    sourceRunner *RunnerInfo
    targetRunner *RunnerInfo
}

func (mm *MigrationManager) MigrateSandbox(sandboxID string) error {
    // 1. 暂停 Sandbox
    mm.PauseSandbox(sandboxID)

    // 2. 导出状态
    state, err := mm.ExportState(sandboxID)
    if err != nil {
        return err
    }

    // 3. 在目标 Runner 创建新 Sandbox
    newSandbox, err := mm.targetRunner.CreateFromState(state)
    if err != nil {
        return err
    }

    // 4. 更新 DNS 记录
    mm.updateDNS(sandboxID, newSandbox)

    // 5. 通知用户
    mm.notifyUser(sandboxID, newSandbox)

    // 6. 清理原 Sandbox
    mm.sourceRunner.DeleteSandbox(sandboxID)

    return nil
}
```

### 6.3 健康检查

```go
type HealthChecker struct {
    interval time.Duration
    timeout  time.Duration
}

func (hc *HealthChecker) CheckSandbox(sandbox *Sandbox) error {
    // 1. 检查容器状态
    if sandbox.Status != Running {
        return ErrSandboxNotRunning
    }

    // 2. 检查 Agent SSH
    if !hc.checkSSH(sandbox.SSHPort) {
        return ErrAgentNotResponding
    }

    // 3. 检查 Agent 心跳
    if time.Since(sandbox.LastHeartbeat) > 2*time.Minute {
        return ErrAgentHeartbeatTimeout
    }

    return nil
}

// 健康检查策略
type HealthCheckPolicy struct {
    Interval     time.Duration // 检查间隔
    Timeout     time.Duration // 单次超时
    UnhealthyThreshold int   // 不健康阈值
    HealthyThreshold  int    // 健康阈值
}
```

## 7. 网络管理

### 7.1 网络访问控制

```go
type NetworkPolicy struct {
    Ingress []IngressRule  // 入站规则
    Egress  []EgressRule  // 出站规则
}

type IngressRule struct {
    From   string // CIDR
    Ports  []Port
    Action Action // allow, deny
}

type EgressRule struct {
    To     string // CIDR
    Ports  []Port
    Action Action
}

// 应用网络策略
func (nm *NetworkManager) ApplyNetworkPolicy(podID string, policy *NetworkPolicy) error {
    // 使用 Docker 网络策略或 iptables
}
```

### 7.2 DNS 解析

```go
// Sandbox 内 DNS 配置
type DNSConfig struct {
    Nameservers []string // DNS 服务器
    Search      []string // 搜索域
    Options     []string // DNS 选项
}

// 自动配置 DNS
func (nm *NetworkManager) ConfigureDNS(sandbox *Sandbox) error {
    dnsConfig := &DNSConfig{
        Nameservers: []string{"8.8.8.8", "8.8.4.4"},
        Search:      []string{fmt.Sprintf("%s.codepod.local", sandbox.Workspace)},
    }

    return nm.docker.UpdateContainerDNS(sandbox.ContainerID, dnsConfig)
}
```

### 7.3 反向隧道 (Runner 在 NAT 后)

```go
// 当 Runner 在 NAT/防火墙后时，需要反向隧道连接 Server
type TunnelManager struct {
    serverAddr string
    tunnelConn net.Conn
}

// Runner 启动时建立反向隧道
func (tm *TunnelManager) Connect() error {
    conn, err := grpc.Dial(tm.serverAddr, grpc.WithTransportCredentials(mtlsCredentials))
    if err != nil {
        return err
    }

    // 建立反向隧道
    stream, err := conn.OpenStream(context.Background())
    if err != nil {
        return err
    }

    tm.tunnelConn = stream
    return nil
}

// Server 通过隧道推送 Job
func (s *Server) PushJobViaTunnel(runnerID string, job *Job) error {
    tunnel := s.tunnels[runnerID]
    return tunnel.Send(job)
}
```

## 8. 安全管理

### 8.1 镜像安全扫描

```go
type ImageScanner interface {
    Scan(image string) (*ScanResult, error)
}

type ScanResult struct {
    Vulnerabilities []Vulnerability
    OK            bool
}

type Vulnerability struct {
    ID          string
    Severity    string // critical, high, medium, low
    Description string
    FixVersion  string
}

// 扫描配置
type ScanConfig struct {
    Enabled     bool
    SeverityCutoff string // 只扫描此级别以上的漏洞
    AllowUntrusted bool  // 允许未信任镜像
}
```

### 8.2 运行时安全

```go
type RuntimeSecurity struct {
    FalcoEnabled bool
    SeccompProfile string
    AppArmorProfile string
}

// 集成 Falco
type FalcoMonitor struct {
    socketPath string
}

func (fm *FalcoMonitor) Start() error {
    // 监控容器运行时行为
    // 检测异常行为
}

// 安全事件处理
func (fm *FalcoMonitor) HandleEvent(event *SecurityEvent) {
    switch event.Severity {
    case Critical:
        fm.stopContainer(event.ContainerID)
        fm.notifySecurityTeam(event)
    case High:
        fm.notifySecurityTeam(event)
    }
}
```

## 9. 故障处理

### 9.1 Docker 故障

```go
type DockerFailureHandler struct {
    docker *docker.Client
}

func (h *DockerFailureHandler) Handle(err error) error {
    switch err.(type) {
    case *docker DaemonError:
        // Docker daemon 无响应
        return h.handleDaemonCrash()
    case *docker ImageNotFound:
        // 镜像拉取失败
        return h.handleImagePullFailure(err)
    case *docker NetworkError:
        // 网络错误
        return h.handleNetworkError(err)
    }
    return err
}

func (h *DockerFailureHandler) handleDaemonCrash() error {
    // 1. 等待 Docker 恢复
    // 2. 重新连接
    // 3. 恢复 Sandbox 状态
}
```

### 9.2 Runner 故障

```go
type RunnerFailureHandler struct {
    server *Server
}

func (h *RunnerFailureHandler) OnRunnerOffline(runnerID string) {
    // 1. 标记 Runner 为 offline
    h.server.MarkRunnerOffline(runnerID)

    // 2. 获取该 Runner 上的 Sandbox
    sandboxes := h.server.GetRunnerSandboxes(runnerID)

    // 3. 重新调度 Sandbox
    for _, sandbox := range sandboxes {
        // 迁移到其他 Runner 或标记为需要恢复
        h.server.MarkSandboxNeedsRecovery(sandbox.ID)
    }
}
```

### 9.3 灾难恢复

```go
type DisasterRecovery struct {
    backupDir string
}

func (dr *DisasterRecovery) Backup() error {
    // 1. 备份数据库
    dr.backupDatabase()

    // 2. 备份 Runner 状态
    dr.backupRunnerState()

    // 3. 备份 Sandbox 元数据
    dr.backupSandboxMetadata()
}

func (dr *DisasterRecovery) Restore(backupID string) error {
    // 1. 恢复数据库
    dr.restoreDatabase(backupID)

    // 2. 恢复 Runner 状态
    dr.restoreRunnerState(backupID)

    // 3. 重新连接 Runner
    dr.reconnectRunners()

    // 4. 恢复 Sandbox
    dr.restoreSandboxes(backupID)
}
```

## 10. Webhook 通知

### 10.1 Webhook 机制

```go
type WebhookManager struct {
    clients map[string]*WebhookClient
    mu     sync.RWMutex
}

type WebhookEvent struct {
    EventType string    `json:"event_type"`
    Timestamp time.Time `json:"timestamp"`
    Sandbox  *Sandbox  `json:"sandbox,omitempty"`
    Job      *Job     `json:"job,omitempty"`
    Error    string   `json:"error,omitempty"`
}

type WebhookEventType string
const (
    EventSandboxCreated  WebhookEventType = "sandbox.created"
    EventSandboxDeleted  WebhookEventType = "sandbox.deleted"
    EventSandboxStarted  WebhookEventType = "sandbox.started"
    EventSandboxStopped  WebhookEventType = "sandbox.stopped"
    EventJobCompleted    WebhookEventType = "job.completed"
    EventJobFailed      WebhookEventType = "job.failed"
    EventRunnerOffline  WebhookEventType = "runner.offline"
)
```

### 10.2 Webhook 配置

```go
type WebhookConfig struct {
    URL        string            // Webhook URL
    Events     []WebhookEventType // 订阅的事件类型
    Secret    string            // 签名密钥
    Timeout   time.Duration     // 超时时间
    Retry    *RetryPolicy      // 重试策略
}

// Webhook 配置示例
webhooks:
  - url: "https://example.com/webhook"
    events:
      - sandbox.created
      - sandbox.deleted
      - job.completed
    secret: "your-secret"
    retry:
      max_attempts: 3
      initial_delay: 1s
```

### 10.3 事件推送

```go
func (wm *WebhookManager) Publish(event WebhookEvent) {
    // 1. 签名
    payload := signPayload(event, secret)

    // 2. 发送到所有订阅的 Webhook
    for _, client := range wm.getSubscribedClients(event.Type) {
        go func(c *WebhookClient) {
            err := c.Send(payload)
            if err != nil {
                log.Error("Webhook send failed", "error", err)
            }
        }(client)
    }
}

// 签名
func signPayload(event WebhookEvent, secret string) string {
    payload := fmt.Sprintf("%s.%d.%s", event.EventType, event.Timestamp.Unix(), event.Sandbox.ID)
    h := hmac.New(sha256.New, []byte(secret))
    h.Write([]byte(payload))
    return fmt.Sprintf("%s.%s", payload, hex.EncodeToString(h.Sum(nil)))
}
```

## 11. 审计日志

### 11.1 审计事件

```go
type AuditEvent struct {
    ID         string    `json:"id"`
    Timestamp  time.Time `json:"timestamp"`
    UserID    string    `json:"user_id"`
    Action    string    `json:"action"`
    Resource  string    `json:"resource"`
    Result    string    `json:"result"` // success, failed
    Details   string    `json:"details,omitempty"`
    IP        string    `json:"ip_address"`
}

type AuditAction string
const (
    AuditCreateSandbox AuditAction = "create.sandbox"
    AuditDeleteSandbox AuditAction = "delete.sandbox"
    AuditStartSandbox AuditAction = "start.sandbox"
    AuditStopSandbox  AuditAction = "stop.sandbox"
    AuditCreateSnapshot AuditAction = "create.snapshot"
    AuditRestoreSnapshot AuditAction = "restore.snapshot"
    AuditUpdateConfig  AuditAction = "update.config"
    AuditCreateAPIKey AuditAction = "create.api_key"
    AuditDeleteAPIKey AuditAction = "delete.api_key"
)
```

### 11.2 审计存储

```go
type AuditStore interface {
    Write(event *AuditEvent) error
    Query(query *AuditQuery) ([]*AuditEvent, error)
}

type AuditQuery struct {
    UserID    string
    Action   AuditAction
    StartTime time.Time
    EndTime  time.Time
    Resource string
    Limit    int
    Offset   int
}

// 审计日志存储
type AuditLogger struct {
    store AuditStore
}

func (al *AuditLogger) Log(action AuditAction, userID, resource string, result string, details string) {
    event := &AuditEvent{
        ID:        uuid.New().String(),
        Timestamp: time.Now(),
        UserID:    userID,
        Action:    string(action),
        Resource:  resource,
        Result:    result,
        Details:   details,
    }

    al.store.Write(event)
}
```

### 11.3 审计查询

```go
// 查询审计日志
func (al *AuditLogger) QuerySandboxHistory(sandboxID string) ([]*AuditEvent, error) {
    return al.store.Query(&AuditQuery{
        Resource: sandboxID,
        Limit:   100,
    })
}

// 审计报表
func (al *AuditLogger) GenerateReport(start, end time.Time) (*AuditReport, error) {
    events, err := al.store.Query(&AuditQuery{
        StartTime: start,
        EndTime:  end,
    })
    if err != nil {
        return nil, err
    }

    return &AuditReport{
        Period:      fmt.Sprintf("%s - %s", start, end),
        TotalEvents: len(events),
        ByAction:    groupByAction(events),
        ByUser:      groupByUser(events),
    }, nil
}
```

## 12. 多 Workspace 支持

### 12.1 Workspace 概念

```go
type Workspace struct {
    ID          string
    Name        string
    Description string
    OwnerID     string
    Quota       *Quota
    Settings    *WorkspaceSettings
    CreatedAt   time.Time
    UpdatedAt   time.Time
}

type WorkspaceSettings struct {
    DefaultNetwork string
    DNSEnabled   bool
    DNSSuffix    string
    DefaultEnv   map[string]string
}
```

### 12.2 Workspace 隔离

```go
type Workspace隔离 struct {
    network    string   // 独立网络
    quota      *Quota  // 资源配额
    sandboxes  []string // Sandbox 列表
}

func (w *Workspace) Isolate() error {
    // 1. 创建独立网络
    network, err := docker.CreateNetwork(fmt.Sprintf("codepod-ws-%s", w.ID))
    if err != nil {
        return err
    }

    // 2. 配置网络策略
    network.AttachNetworkPolicy(map[string]string{
        "isolate": "true",
    })

    // 3. 存储 Workspace 信息
    return w.store.Save(w)
}
```

### 12.3 Workspace 管理

```go
type WorkspaceManager struct {
    store AuditStore
    quota  *QuotaManager
}

func (wm *WorkspaceManager) CreateWorkspace(req *CreateWorkspaceRequest) (*Workspace, error) {
    // 1. 检查配额
    if err := wm.quota.CheckQuota(req.OwnerID, req.Quota); err != nil {
        return nil, err
    }

    // 2. 创建 Workspace
    workspace := &Workspace{
        ID:          uuid.New().String(),
        Name:        req.Name,
        Description: req.Description,
        OwnerID:     req.OwnerID,
        Quota:       req.Quota,
        Settings:    req.Settings,
        CreatedAt:   time.Now(),
    }

    // 3. 创建网络
    if err := wm.createNetwork(workspace); err != nil {
        return nil, err
    }

    // 4. 保存
    return workspace, wm.store.Save(workspace)
}

func (wm *WorkspaceManager) ListWorkspaces(userID string) ([]*Workspace, error) {
    return wm.store.ListByUser(userID)
}
```

### 12.4 Workspace 资源配额

```go
type WorkspaceQuota struct {
    MaxSandboxes    int   // 最大 Sandbox 数
    MaxCPU         int64 // CPU 核心数
    MaxMemory      int64 // 内存 (bytes)
    MaxStorage     int64 // 存储 (bytes)
    MaxSnapshots   int   // 最大快照数
    MaxWorkspaces  int   // 最大工作空间数
}

// Workspace 配额检查
func (qm *QuotaManager) CheckWorkspaceQuota(workspaceID string, req *CreateSandboxRequest) error {
    ws, err := qm.store.GetWorkspace(workspaceID)
    if err != nil {
        return err
    }

    used := ws.GetUsage()

    if used.Sandboxes+1 > ws.Quota.MaxSandboxes {
        return ErrWorkspaceSandboxQuotaExceeded
    }

    if used.CPU+req.CPU > ws.Quota.MaxCPU {
        return ErrWorkspaceCPUQuotaExceeded
    }

    if used.Memory+req.Memory > ws.Quota.MaxMemory {
        return ErrWorkspaceMemoryQuotaExceeded
    }

    return nil
}
```

## 13. 监控与可观测性

### 10.1 Prometheus 指标

```go
var (
    // Job 指标
    jobDuration = prometheus.NewHistogramVec(
        prometheus.HistogramOpts{
            Name:    "codepod_job_duration_seconds",
            Help:    "Job duration in seconds",
            Buckets: []float64{1, 5, 10, 30, 60, 300},
        },
        []string{"type", "status"},
    )

    // Sandbox 指标
    activeSandboxes = prometheus.NewGauge(
        prometheus.GaugeOpts{
            Name: "codepod_active_sandboxes_total",
            Help: "Number of active sandboxes",
        },
    )

    // Runner 资源指标
    runnerCPUUsage = prometheus.NewGaugeVec(
        prometheus.GaugeOpts{
            Name: "codepod_runner_cpu_usage_percent",
            Help: "CPU usage percentage",
        },
        []string{"runner_id"},
    )
)
```

### 10.2 链路追踪

```go
import "go.opentelemetry.io/otel"

func (js *JobScheduler) ExecuteJob(job *Job) {
    ctx, span := otel.Tracer("runner").Start(context.Background(), "ExecuteJob",
        trace.WithAttributes(attribute.String("job.id", job.ID)))

    defer span.End()

    // 创建 Sandbox
    sandbox, err := js.createSandbox(ctx, job)
    if err != nil {
        span.RecordError(err)
        return
    }

    span.SetAttributes(attribute.String("sandbox.id", sandbox.ID))
}
```

### 10.3 日志聚合

```go
type LogAggregator struct {
    buffer *logrus.Logger
    output io.Writer
}

func (la *LogAggregator) Start() {
    // 1. 收集容器日志
    // 2. 收集 Agent 日志
    // 3. 聚合后发送到日志服务 (Elasticsearch, Loki)

    go la.collectContainerLogs()
    go la.collectAgentLogs()
}

func (la *LogAggregator) collectContainerLogs() {
    logs, err := la.docker.ContainerLogs(context.Background(), containerID)
    // 处理并发送
}
```

## 12. 接口设计

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

## 13. 部署模式

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

## 14. 安全设计

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

## 15. 目录结构

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

## 16. 配置示例

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

## 17. 依赖

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
