# TS SDK Log Stream 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 TS SDK 增加命令执行实时输出流式回调功能，参考 E2B/Daytona 接口设计。

**Architecture:** SDK 从 Server 获取 Agent 连接信息，直连 Agent gRPC 执行命令，通过回调函数实时获取 stdout/stderr 输出。支持多路复用、链路保活和自动恢复。

**Tech Stack:** gRPC (Go/TypeScript), Protobuf, ssh2 (现有)

---

## Task 1: Agent 新增 gRPC 服务

**Files:**
- Modify: `sandbox/agent/cmd/main.go:88-113`
- Create: `sandbox/agent/pkg/grpc/server.go`
- Create: `sandbox/agent/pkg/grpc/exec.go`
- Create: `sandbox/agent/proto/exec.proto`
- Modify: `sandbox/agent/pkg/config/config.go`

**Step 1: 创建 proto 定义**

```protobuf
// sandbox/agent/proto/exec.proto
syntax = "proto3";

package grpc;

service ExecService {
  rpc OpenSession(OpenSessionRequest) returns (stream CommandOutput);
  rpc Execute(ExecuteRequest) returns (stream CommandOutput);
}

message OpenSessionRequest {
  string sandbox_id = 1;
  string token = 2;
}

message ExecuteRequest {
  string command = 1;
  string cwd = 2;
  map<string, string> env = 3;
  int64 timeout = 4;
}

message CommandOutput {
  string line = 1;
  OutputChannel channel = 2;
  bool end = 3;
  int32 exit_code = 4;
}

enum OutputChannel {
  STDOUT = 0;
  STDERR = 1;
}
```

**Step 2: 修改 config 添加 gRPC 端口配置**

```go
// sandbox/agent/pkg/config/config.go
type Config struct {
    // ... existing fields
    GRPC struct {
        Port int
    }
}
```

**Step 3: 实现 gRPC 服务**

```go
// sandbox/agent/pkg/grpc/server.go
type Server struct {
    proto.UnimplementedExecServiceServer
    port int
    token string
}

func (s *Server) Execute(req *ExecuteRequest, stream ExecService_ExecuteServer) error {
    // fork 子进程，通过管道获取输出
    // 流式发送到客户端
}
```

**Step 4: 在 main.go 启动 gRPC 服务**

```go
// sandbox/agent/cmd/main.go
grpcServer := grpc.NewServer(cfg.GRPC.Port, cfg.Agent.Token)
go grpcServer.Start(ctx)
```

**Step 5: Commit**

```bash
git add sandbox/agent/ && git commit -m "feat(agent): add gRPC service for command execution"
```

---

## Task 2: Runner 暴露 Agent gRPC 端口

**Files:**
- Modify: `sandbox/runner/pkg/sandbox/manager.go:107-113`
- Modify: `sandbox/server/src/routes/` - 新增推送端点

**Step 1: 修改容器配置暴露 gRPC 端口**

```go
// sandbox/runner/pkg/sandbox/manager.go
Ports: []docker.PortBinding{
    {ContainerPort: 2222, HostPort: 0, Protocol: "tcp"},  // SSH
    {ContainerPort: 50052, HostPort: 0, Protocol: "tcp"}, // gRPC
},
```

**Step 2: 获取映射后的端口**

```go
// 获取 gRPC 端口映射
grpcPort := getHostPort(containerID, 50052)
```

**Step 3: 推送地址到 Server**

```go
// 调用 Server API 推送 Agent 地址
serverURL := opts.AgentServerURL // http://server:8080
pushAgentAddress(sandboxID, host, grpcPort, token, serverURL)
```

**Step 4: Server 新增推送端点**

```typescript
// sandbox/server/src/routes/sandbox.ts
POST /api/v1/sandboxes/:id/agent-address
Body: { host, port, token }
```

**Step 5: Commit**

```bash
git add sandbox/runner/ sandbox/server/ && git commit -m "feat(runner): expose Agent gRPC port and push address to Server"
```

---

## Task 3: Server 新增连接信息 API

**Files:**
- Create: `sandbox/server/src/routes/connection.ts`
- Modify: `sandbox/server/src/server.ts` - 注册路由

**Step 1: 创建连接信息路由**

```typescript
// sandbox/server/src/routes/connection.ts
router.get('/api/v1/sandboxes/:id/connection', async (req, res) => {
  const { id } = req.params;
  const connection = await getSandboxConnection(id);
  res.json(connection);
});
```

**Step 2: 在 server.ts 注册路由**

```typescript
// sandbox/server/src/server.ts
app.use('/api/v1/sandboxes', connectionRouter);
```

**Step 3: Commit**

```bash
git add sandbox/server/src/routes/ && git commit -m "feat(server): add connection info API endpoint"
```

---

## Task 4: TS SDK 新增 gRPC 客户端

**Files:**
- Create: `libs/sdk-ts/src/grpc/client.ts`
- Create: `libs/sdk-ts/src/grpc/types.ts`
- Modify: `libs/sdk-ts/src/client/index.ts` - 新增 getConnectionInfo 方法
- Modify: `libs/sdk-ts/src/sandbox/index.ts` - 新增 commands.run 接口

**Step 1: 创建 gRPC 客户端**

```typescript
// libs/sdk-ts/src/grpc/client.ts
import * as grpc from '@grpc/grpc-js';

export class ExecClient {
  private client: grpc.Client;

  constructor(host: string, port: number, token: string) {
    const creds = grpc.credentials.createInsecure();
    this.client = new grpc.client(ExecService, { host: `${host}:${port}`, creds });
  }

  execute(command: string, callbacks: {
    onStdout?: (data: string) => void;
    onStderr?: (data: string) => void;
  }): Promise<CommandResult> {
    // 实现
  }
}
```

**Step 2: 修改 CodePodClient 新增方法**

```typescript
// libs/sdk-ts/src/client/index.ts
async getConnectionInfo(sandboxId: string): Promise<ConnectionInfo> {
  const response = await this.client.get(`/api/v1/sandboxes/${sandboxId}/connection`);
  return response.data;
}
```

**Step 3: 修改 Sandbox 类**

```typescript
// libs/sdk-ts/src/sandbox/index.ts
class Sandbox {
  commands = {
    run: async (command: string, options?: {
      onStdout?: (data: string) => void;
      onStderr?: (data: string) => void;
      timeout?: number;
    }): Promise<CommandResult> => {
      // 1. 获取连接信息
      // 2. 建立 gRPC 连接
      // 3. 执行命令，回调输出
    }
  };
}
```

**Step 4: Commit**

```bash
git add libs/sdk-ts/src/ && git commit -m "feat(sdk-ts): add gRPC client and commands.run interface"
```

---

## Task 5: SDK 测试验证

**Files:**
- Create: `libs/sdk-ts/src/sandbox/commands.test.ts`

**Step 1: 编写测试**

```typescript
// libs/sdk-ts/src/sandbox/commands.test.ts
test('run command with stdout callback', async () => {
  const sandbox = await createTestSandbox();
  const outputs: string[] = [];

  const result = await sandbox.commands.run('echo hello', {
    onStdout: (data) => outputs.push(data),
  });

  expect(outputs).toContain('hello\n');
  expect(result.exitCode).toBe(0);
});
```

**Step 2: 运行测试**

```bash
cd libs/sdk-ts && npm test
```

**Step 3: Commit**

```bash
git add libs/sdk-ts/src/sandbox/commands.test.ts && git commit -m "test(sdk-ts): add commands.run tests"
```

---

## Task 6: 集成测试（可选）

**Files:**
- Create: `sandbox/server/e2e/log-stream.test.ts`

**Step 1: 编写端到端测试**

```typescript
// 完整流程测试：
// 1. Server 创建 sandbox
// 2. SDK 获取连接信息
// 3. SDK 执行命令，验证回调
```

---

## 执行顺序

1. Task 1: Agent gRPC 服务
2. Task 2: Runner 端口暴露
3. Task 3: Server 连接 API
4. Task 4: SDK gRPC 客户端
5. Task 5: SDK 测试

---

## 依赖关系

```
Task 1 (Agent gRPC)
    ↓
Task 2 (Runner 端口) → Task 3 (Server API)
    ↓                      ↓
    └────────→ Task 4 (SDK) ←
                    ↓
               Task 5 (测试)
```

---

Plan complete and saved to `docs/plans/2026-02-22-ts-sdk-log-stream-implementation.md`.

**Two execution options:**

1. **Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

2. **Parallel Session (separate)** - Open new session with executing_plans, batch execution with checkpoints

Which approach?
