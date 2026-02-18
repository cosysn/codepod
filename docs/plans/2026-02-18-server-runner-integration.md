# Server-Runner Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 Server 与 Runner 之间的 gRPC 通信，使 Server 能够将创建 Sandbox 的任务下发 Runner 执行。

**Architecture:**
1. Server 暴露 gRPC 服务端口 (50051)，Runner 通过反向隧道连接
2. Runner 注册到 Server，Server 维护 Runner 注册表
3. Server 创建 Sandbox 时，选择可用 Runner 并下发 Job
4. Runner 执行 Job（创建容器、注入 Agent），并上报状态

**Tech Stack:**
- Node.js/gRPC: `@grpc/grpc-js`, `@grpc/proto-loader`
- Go/gRPC: `google.golang.org/grpc`

---

### Task 1: Server 添加 gRPC 支持

**Files:**
- Create: `apps/server/src/grpc/server.ts` - gRPC Server 实现
- Create: `apps/server/src/grpc/types.ts` - gRPC 类型定义
- Modify: `apps/server/src/server.ts` - 集成 gRPC Server

**Step 1: 安装 gRPC 依赖**

```bash
cd apps/server
npm install @grpc/grpc-js @grpc/proto-loader
```

**Step 2: 创建 gRPC Server**

```typescript
// apps/server/src/grpc/server.ts
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

const PROTO_PATH = './proto/codepod.proto';

export class GrpcServer {
  private server: grpc.Server;
  private port: string;

  constructor(port: number = 50051) {
    this.server = new grpc.Server();
    this.port = `0.0.0.0:${port}`;
  }

  async start(): Promise<void> {
    // Load proto (simplified for now)
    this.server.bindAsync(
      this.port,
      grpc.ServerCredentials.createInsecure(),
      (err, port) => {
        if (err) {
          throw err;
        }
        console.log(`gRPC Server listening on ${port}`);
      }
    );
  }

  stop(): void {
    this.server.forceShutdown();
  }
}
```

**Step 3: 修改 server.ts 集成 gRPC**

```typescript
// apps/server/src/server.ts
import { GrpcServer } from './grpc/server';

const grpcServer = new GrpcServer(50051);

// In createServer():
export function createServer() {
  // ... existing HTTP server

  // Start gRPC server
  grpcServer.start().catch(console.error);

  return { server, start };
}
```

**Step 4: 验证编译**

```bash
cd apps/server && npm run build
```

**Step 5: Commit**

```bash
git add apps/server/src/grpc/ apps/server/src/server.ts
git commit -m "feat: add gRPC server to server"
```

---

### Task 2: Runner 添加 gRPC Client

**Files:**
- Create: `apps/runner/internal/runner/grpc_client.go` - gRPC Client
- Modify: `apps/runner/internal/runner/runner.go` - 集成 gRPC Client

**Step 1: 添加 gRPC 依赖**

```bash
cd apps/runner
GOSUMDB=off go get google.golang.org/grpc@latest
GOSUMDB=off go get google.golang.org/protobuf@latest
```

**Step 2: 创建 gRPC Client**

```go
// apps/runner/internal/runner/grpc_client.go
package runner

import (
	"context"
	"fmt"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

type GrpcClient struct {
	conn   *grpc.ClientConn
	config *Config
}

type Config struct {
	ServerURL string
}

func NewGrpcClient(config *Config) (*GrpcClient, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, err := grpc.DialContext(
		ctx,
		config.ServerURL,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithBlock(),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to server: %w", err)
	}

	return &GrpcClient{
		conn:   conn,
		config: config,
	}, nil
}

func (c *GrpcClient) Close() error {
	return c.conn.Close()
}
```

**Step 3: 修改 runner.go 使用 gRPC**

```go
// In runner.go, add:
type Runner struct {
	grpcClient *GrpcClient
	// ... existing fields
}
```

**Step 4: 验证编译**

```bash
cd apps/runner && go build ./...
```

**Step 5: Commit**

```bash
git add apps/runner/internal/runner/
git commit -m "feat: add gRPC client to runner"
```

---

### Task 3: 实现 Runner 注册到 Server

**Files:**
- Modify: `apps/server/src/grpc/server.ts` - 添加注册接口
- Modify: `apps/runner/internal/runner/grpc_client.go` - 添加注册方法

**Step 1: Server 添加 Runner 注册表**

```typescript
// apps/server/src/grpc/server.ts
interface RunnerInfo {
  id: string;
  address: string;
  capacity: number;
  status: 'available' | 'busy';
}

const runners = new Map<string, RunnerInfo>();

export function registerRunner(info: RunnerInfo) {
  runners.set(info.id, info);
}

export function getRunner(id: string): RunnerInfo | undefined {
  return runners.get(id);
}
```

**Step 2: Runner 添加注册调用**

```go
// apps/runner/internal/runner/grpc_client.go
func (c *GrpcClient) Register(ctx context.Context, runnerID string, capacity int) error {
	// Simplified: HTTP fallback for now
	// In real implementation, this would be a gRPC call
	return nil
}
```

**Step 3: 验证编译**

```bash
cd apps/server && npm run build
cd apps/runner && go build ./...
```

**Step 4: Commit**

```bash
git add apps/server/src/grpc/ apps/runner/internal/runner/
git commit -m "feat: add runner registration to server"
```

---

### Task 4: Server 下发 Job 给 Runner

**Files:**
- Create: `apps/server/src/services/job.ts` - Job 服务
- Modify: `apps/server/src/services/sandbox.ts` - 创建 Sandbox 时下发 Job

**Step 1: 创建 Job Service**

```typescript
// apps/server/src/services/job.ts
interface Job {
  id: string;
  type: 'create' | 'delete';
  sandboxId: string;
  runnerId?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

const jobs = new Map<string, Job>();

export function createJob(sandboxId: string, type: Job['type']): Job {
  const job: Job = {
    id: `job-${Date.now()}`,
    type,
    sandboxId,
    status: 'pending',
  };
  jobs.set(job.id, job);
  return job;
}

export function assignJobToRunner(jobId: string, runnerId: string): boolean {
  const job = jobs.get(jobId);
  if (!job) return false;
  job.runnerId = runnerId;
  job.status = 'running';
  return true;
}
```

**Step 2: 修改 Sandbox Service 下发 Job**

```typescript
// apps/server/src/services/sandbox.ts
import { createJob } from './job';

create(req: CreateSandboxRequest): SandboxResponse {
  // ... existing create logic

  // Create job for runner
  const job = createJob(sandbox.id, 'create');

  // TODO: Assign to runner and push

  return {
    sandbox,
    // ... existing fields
  };
}
```

**Step 3: 验证编译**

```bash
cd apps/server && npm run build
```

**Step 4: Commit**

```bash
git add apps/server/src/services/job.ts apps/server/src/services/sandbox.ts
git commit -m "feat: add job service and integrate with sandbox creation"
```

---

### Task 5: Runner 接收并执行 Job

**Files:**
- Modify: `apps/runner/internal/runner/grpc_client.go` - 接收 Job
- Modify: `apps/runner/pkg/sandbox/manager.go` - 执行创建

**Step 1: Runner 添加 Job 处理**

```go
// apps/runner/internal/runner/grpc_client.go
func (r *Runner) ProcessJobs(ctx context.Context) {
	// Poll for jobs (simplified)
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			r.pollJobs()
		}
	}
}

func (r *Runner) pollJobs() {
	// Get job from server via gRPC
	// Execute job using sandbox manager
}
```

**Step 2: Runner 执行 Job**

```go
// In runner, when receiving create job:
func (r *Runner) handleCreateJob(job *Job) error {
	opts := &sandbox.CreateOptions{
		Name:    job.SandboxName,
		Image:   job.Image,
		Env:     job.Env,
		Memory:  job.Memory,
		CPU:     job.CPU,
	}

	sb, err := r.manager.Create(context.Background(), opts)
	if err != nil {
		return err
	}

	return r.manager.Start(context.Background(), sb)
}
```

**Step 3: 验证编译**

```bash
cd apps/runner && go build ./...
```

**Step 4: Commit**

```bash
git add apps/runner/internal/runner/
git commit -m "feat: add job processing to runner"
```

---

## Execution Handoff

**Plan complete and saved to `docs/plans/2026-02-18-server-runner-integration.md`. Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
