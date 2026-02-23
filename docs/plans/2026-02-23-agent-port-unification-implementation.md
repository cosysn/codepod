# Agent 端口合并实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标:** 将 Agent 的 SSH 和 gRPC 服务合并到单一端口，通过 cmux 实现协议多路复用

**架构:** 使用 cmux 库在单一 TCP 端口上同时支持 SSH 和 gRPC 协议。SSH 协议以 "SSH-" 开头，gRPC 使用 HTTP/2，cmux 可以根据连接前缀自动区分。

**技术栈:** Go (cmux 库), Docker, gRPC, SSH

---

## 任务 1: Agent - 添加 cmux 依赖

**文件:**
- 修改: `sandbox/agent/go.mod`
- 修改: `sandbox/agent/go.sum` (自动生成)

**步骤 1: 添加 cmux 依赖**

Run: `cd sandbox/agent && go get github.com/soheilhy/cmux@v0.1.5`

Expected: 下载 cmux 包

**步骤 2: 提交**

```bash
cd sandbox/agent
git add go.mod go.sum
git commit -m "chore(agent): add cmux dependency for port multiplexing"
```

---

## 任务 2: Agent - 创建 cmux 多路复用服务

**文件:**
- 创建: `sandbox/agent/pkg/multiplex/server.go`
- 修改: `sandbox/agent/cmd/main.go`

**步骤 1: 创建 multiplex server**

```go
package multiplex

import (
	"fmt"
	"net"
	"net/http"

	"github.com/soheilhy/cmux"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"
)

// Server manages multiplexed SSH + gRPC server
type Server struct {
	sshAddr string
	sshHandler func(net.Listener) error
	grpcHandler func(net.Listener) error
}

// New creates a new multiplex server
func New(sshAddr string, sshHandler func(net.Listener) error, grpcHandler func(net.Listener) error) *Server {
	return &Server{
		sshAddr:     sshAddr,
		sshHandler:  sshHandler,
		grpcHandler: grpcHandler,
	}
}

// Start starts the multiplexed server
func (s *Server) Start() error {
	// Create a TCP listener
	listener, err := net.Listen("tcp", s.sshAddr)
	if err != nil {
		return fmt.Errorf("failed to listen on %s: %w", s.sshAddr, err)
	}

	// Create cmux matcher
	m := cmux.New(listener)

	// Match SSH (starts with "SSH-") - use Any() as SSH has specific prefix
	// Actually, SSH protocol starts with "SSH-2.0", so we can match by first bytes
	sshListener := m.Match(cmux.Any())

	// Match HTTP/2 for gRPC
	grpcListener := m.Match(cmux.HTTP2())

	// Start SSH server in goroutine
	go func() {
		if err := s.sshHandler(sshListener); err != nil {
			fmt.Printf("SSH server error: %v\n", err)
		}
	}()

	// Start gRPC server in goroutine
	go func() {
		if err := s.grpcHandler(grpcListener); err != nil {
			fmt.Printf("gRPC server error: %v\n", err)
		}
	}()

	// Block until closed
	return m.Serve()
}
```

**步骤 2: 修改 main.go 使用 multiplex server**

首先备份原文件，然后修改:

```go
// cmd/main.go 需要修改的部分

// 之前:
// grpcServer := grpc.NewServer(cfg.GRPC.Port, cfg.Agent.Token)
// if err := grpcServer.Start(ctx); err != nil { ... }
// if err := server.Start(ctx); err != nil { ... }

// 之后:
// 创建 multiplex server
multiplexServer := multiplex.New(
	fmt.Sprintf(":%d", cfg.SSH.Port),
	func(l net.Listener) error {
		return sshServer.Serve(l) // SSH server
	},
	func(l net.Listener) error {
		// gRPC with h2c (HTTP/2 over cleartext)
		grpcServer := grpc.NewServer(
			grpc.KeepaliveParams(keepalive.ServerParameters{
				Time:    30 * time.Second,
				Timeout: 10 * time.Second,
			}),
			grpc.StreamInterceptor(authStreamInterceptor),
		)
		pb.RegisterExecServiceServer(grpcServer, execServer)
		return grpcServer.Serve(l)
	},
)

// Start multiplexed server (blocks)
if err := multiplexServer.Start(); err != nil {
	log.Fatalf("Failed to start multiplexed server: %v", err)
}
```

**步骤 3: 提交**

```bash
git add sandbox/agent/pkg/multiplex/server.go sandbox/agent/cmd/main.go
git commit -m "feat(agent): add cmux for SSH+gRPC port multiplexing"
```

---

## 任务 3: Agent - 移除 GRPC 端口配置 (可选，保留兼容性)

**文件:**
- 修改: `sandbox/agent/pkg/config/config.go`
- 修改: `sandbox/agent/pkg/config/config_test.go`

**步骤 1: 修改配置**

保留 GRPC 配置以兼容旧版本，但标记为 deprecated

**步骤 2: 提交**

```bash
git add sandbox/agent/pkg/config/
git commit -m "chore(agent): mark GRPC port as deprecated in config"
```

---

## 任务 4: Runner - 移除 gRPC 端口映射

**文件:**
- 修改: `sandbox/runner/internal/runner/runner.go:266-273`
- 修改: `sandbox/runner/pkg/sandbox/manager.go:110-112`

**步骤 1: 修改环境变量**

```go
// runner.go 约第 266-273 行
// 之前:
env := map[string]string{
    "AGENT_TOKEN":       agentToken,
    "AGENT_SANDBOX_ID": job.SandboxID,
    "AGENT_SERVER_URL":  r.cfg.Server.URL,
    "AGENT_SSH_PORT":    "2222",
    "AGENT_GRPC_PORT":   "50052", // 移除这行
}

// 之后:
env := map[string]string{
    "AGENT_TOKEN":       agentToken,
    "AGENT_SANDBOX_ID": job.SandboxID,
    "AGENT_SERVER_URL":  r.cfg.Server.URL,
    "AGENT_SSH_PORT":   "2222",  // 这是统一端口
}
```

**步骤 2: 修改端口映射**

```go
// manager.go 约第 110-112 行
// 之前:
Ports: []docker.PortBinding{
    {ContainerPort: 2222, HostPort: 0, Protocol: "tcp"},
    {ContainerPort: 50052, HostPort: 0, Protocol: "tcp"},  // 移除
}

// 之后:
Ports: []docker.PortBinding{
    {ContainerPort: 2222, HostPort: 0, Protocol: "tcp"},  // 单一端口
}
```

**步骤 3: 修改端口获取逻辑**

```go
// manager.go Start 函数中约第 216-242 行
// 移除 AgentPort 相关逻辑，只保留 Port

// 之前:
// if p.ContainerPort == 2222 { sb.Port = p.HostPort }
// if p.ContainerPort == 50052 { sb.AgentPort = p.HostPort }

// 之后:
// if p.ContainerPort == 2222 { sb.Port = p.HostPort }
// 删除 AgentPort 相关代码
```

**步骤 4: 提交**

```bash
git add sandbox/runner/internal/runner/runner.go sandbox/runner/pkg/sandbox/manager.go
git commit -m "feat(runner): remove gRPC port mapping, use single port"
```

---

## 任务 5: Runner - 移除 AgentPort 字段和上报

**文件:**
- 修改: `sandbox/runner/pkg/sandbox/manager.go:20-27` (Sandbox 结构体)
- 修改: `sandbox/runner/internal/runner/runner.go:358-369` (UpdateAgentAddress 调用)
- 修改: `sandbox/runner/internal/runner/grpc_client.go` (AgentAddressUpdate 结构体)

**步骤 1: 修改 Sandbox 结构体**

```go
// manager.go Sandbox 结构体
// 之前:
type Sandbox struct {
    Port        int
    AgentPort   int  // 移除
    ...
}

// 之后:
type Sandbox struct {
    Port        int  // 统一端口
    // 移除 AgentPort
    ...
}
```

**步骤 2: 修改 UpdateAgentAddress 调用**

```go
// runner.go 约第 358-369 行
// 之前:
if sb.AgentPort > 0 {
    r.client.UpdateAgentAddress(...)
}

// 之后: 完全移除这段代码
```

**步骤 3: 简化 AgentAddressUpdate**

```go
// grpc_client.go
// 可以保留但不再使用，或直接删除
```

**步骤 4: 提交**

```bash
git add sandbox/runner/
git commit -m "refactor(runner): remove AgentPort, use single port"
```

---

## 任务 6: Server - 简化端口类型和 API

**文件:**
- 修改: `sandbox/server/src/types.ts:23-38` (Sandbox 接口)
- 修改: `sandbox/server/src/server.ts:260-277` (/connection 端点)
- 修改: `sandbox/server/src/db/store.ts:126-150` (updateSandboxRunnerStatus)
- 修改: `sandbox/server/src/db/repository-adapter.ts` (如有需要)

**步骤 1: 简化 Sandbox 类型**

```typescript
// types.ts
// 之前:
interface Sandbox {
  id: string;
  port: number;
  agentInfo?: {
    addressPort?: number;
    ...
  };
  ...
}

// 之后:
interface Sandbox {
  id: string;
  port: number;  // 统一端口
  // 移除 agentInfo.addressPort
  agentInfo?: {
    address?: string;  // host:port 组合
    ...
  };
}
```

**步骤 2: 简化 /connection 端点**

```typescript
// server.ts 约 260-277 行
// 之前:
const port = sandbox.agentInfo?.addressPort || sandbox.port;

// 之后:
const port = sandbox.port;  // 直接使用统一端口
```

**步骤 3: 简化 store**

```go
// store.ts
// updateSandboxRunnerStatus 移除 port 和 agentPort 的区分
// 只保留 port
```

**步骤 4: 提交**

```bash
git add sandbox/server/src/
git commit -m "feat(server): simplify port handling, use single port"
```

---

## 任务 7: 集成测试 - 验证端口合并

**文件:**
- 测试现有 e2e 测试或创建新测试

**步骤 1: 运行现有测试**

```bash
cd sandbox/agent && go test ./...
cd sandbox/runner && go test ./...
cd sandbox/server && npm test
```

**步骤 2: 手动测试**

1. 启动 Docker 服务
2. 创建 sandbox
3. 验证 SSH 连接: `ssh user@host -p <port>`
4. 验证 gRPC 连接 (使用 SDK)

**步骤 3: 提交测试结果**

```bash
git commit -m "test: verify port unification works"
```

---

## 执行顺序

1. 任务 1: 添加 cmux 依赖
2. 任务 2: 创建 multiplex server
3. 任务 3: 清理配置 (可选)
4. 任务 4: Runner 移除端口映射
5. 任务 5: Runner 移除 AgentPort
6. 任务 6: Server 简化端口处理
7. 任务 7: 测试验证

---

## 注意事项

1. 保持向后兼容: 旧版本 Agent 仍可工作
2. 测试每一步: 每个任务后运行测试
3. 渐进式部署: 先部署新 Agent，再更新 Server
