# Runner Job Status Reporting Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 Runner 任务状态回报告知 Server，使 Sandbox 状态能正确从 "pending" 更新到 "running"。

**Architecture:**
- Runner 创建 Sandbox 成功后，调用 Server API 更新状态
- Runner 删除 Sandbox 前，先更新状态为 "deleting"
- 提供进度报告接口（可选增强）
- Server 存储 sandbox 的 Runner ID 便于追踪

**Tech Stack:**
- Runner: Go HTTP Client (`net/http`)
- Server: Express.js REST API
- 通信协议: HTTP JSON

---

### Task 1: Server 添加 Sandbox 状态更新端点

**Files:**
- Modify: `apps/server/src/server.ts` - 添加 `/api/v1/sandboxes/:id/runner-status` 端点
- Modify: `apps/server/src/db/store.ts` - 添加 `updateSandboxRunnerStatus` 方法

**Step 1: 添加 Store 方法更新 Runner 状态**

```typescript
// apps/server/src/db/store.ts

/**
 * Update sandbox with runner-assigned information
 */
updateSandboxRunnerStatus(
  id: string,
  status: {
    runnerId?: string;
    containerId?: string;
    sandboxStatus?: SandboxStatus;
  }
): Sandbox | undefined {
  const sandbox = this.sandboxes.get(id);
  if (!sandbox) return undefined;

  const updated = { ...sandbox };
  if (status.runnerId) {
    updated.runnerId = status.runnerId;
  }
  if (status.containerId) {
    updated.containerId = status.containerId;
  }
  if (status.sandboxStatus) {
    updated.status = status.sandboxStatus;
  }

  this.sandboxes.set(id, updated);
  return updated;
}
```

**Step 2: 添加 Server 端点**

```typescript
// apps/server/src/server.ts

// Runner status update endpoint
const runnerStatusMatch = path.match(/^\/api\/v1\/sandboxes\/([a-zA-Z0-9-]+)\/runner-status$/);
if (runnerStatusMatch && method === 'POST') {
  const sandboxId = runnerStatusMatch[1];
  const runnerId = req.headers['x-runner-id'] as string;

  if (!runnerId) {
    sendError(res, 400, 'Missing X-Runner-Id header');
    return;
  }

  const body = await parseBody(req);
  const data = body as {
    status: SandboxStatus;
    containerId?: string;
    message?: string;
  };

  const sandbox = store.getSandbox(sandboxId);
  if (!sandbox) {
    sendError(res, 404, 'Sandbox not found');
    return;
  }

  // Verify this sandbox is assigned to this runner
  if (sandbox.runnerId && sandbox.runnerId !== runnerId) {
    sendError(res, 403, 'Sandbox is assigned to a different runner');
    return;
  }

  // Update sandbox status
  store.updateSandboxRunnerStatus(sandboxId, {
    runnerId,
    containerId: data.containerId,
    sandboxStatus: data.status,
  });

  // Log the status change
  store.log('UPDATE', 'sandbox', sandboxId, runnerId, {
    status: data.status,
    message: data.message,
  });

  sendJson(res, 200, { success: true, sandboxId, status: data.status });
  return;
}
```

**Step 3: 验证编译**

```bash
cd apps/server && npm run build
```

**Step 4: Commit**

```bash
git add apps/server/src/db/store.ts apps/server/src/server.ts
git commit -m "feat: add sandbox runner status update endpoint"
```

---

### Task 2: Runner 添加状态报告客户端方法

**Files:**
- Modify: `apps/runner/internal/runner/grpc_client.go` - 添加 `UpdateSandboxStatus` 方法

**Step 1: 添加状态更新方法**

```go
// apps/runner/internal/runner/grpc_client.go

// SandboxStatusUpdate represents a status update request
type SandboxStatusUpdate struct {
	Status      string `json:"status"`
	ContainerID string `json:"containerId,omitempty"`
	Message     string `json:"message,omitempty"`
}

// UpdateSandboxStatus sends a status update to the server
func (c *GrpcClient) UpdateSandboxStatus(ctx context.Context, sandboxID string, update *SandboxStatusUpdate) error {
	url := fmt.Sprintf("%s/api/v1/sandboxes/%s/runner-status", c.config.ServerURL, sandboxID)

	data, err := json.Marshal(update)
	if err != nil {
		return fmt.Errorf("failed to marshal status update: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Runner-Id", c.config.RunnerID)

	resp, err := c.client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send status update: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("server returned status %d", resp.StatusCode)
	}

	return nil
}
```

**Step 2: 验证编译**

```bash
cd apps/runner && go build ./...
```

**Step 3: Commit**

```bash
git add apps/runner/internal/runner/grpc_client.go
git commit -m "feat: add UpdateSandboxStatus method to runner client"
```

---

### Task 3: Runner 在创建/删除 Sandbox 时报告状态

**Files:**
- Modify: `apps/runner/internal/runner/runner.go` - 在 handleCreateJob 和 handleDeleteJob 中调用状态更新

**Step 1: 修改 handleCreateJob**

```go
// apps/runner/internal/runner/runner.go

func (r *Runner) handleCreateJob(job *Job) error {
	ctx := context.Background()

	// Extract job data from payload
	payload, ok := job.Payload.(map[string]interface{})
	if !ok {
		return fmt.Errorf("invalid job payload")
	}

	sandboxName := payload["sandboxId"].(string)
	image := payload["image"].(string)

	// Report status: creating
	if err := r.client.UpdateSandboxStatus(ctx, sandboxName, &GrpcClient.SandboxStatusUpdate{
		Status:  "creating",
		Message: "Creating container",
	}); err != nil {
		log.Printf("Warning: failed to report creating status: %v", err)
	}

	// Create sandbox
	opts := &sandbox.CreateOptions{
		Name:    sandboxName,
		Image:   image,
		Env:     map[string]string{
			"AGENT_TOKEN":       payload["agentToken"].(string),
			"AGENT_SANDBOX_ID": sandboxName,
			"AGENT_SERVER_URL":  r.config.Server.URL,
		},
		AgentBinaryPath: "/usr/local/bin/agent",
	}

	sb, err := r.manager.Create(ctx, opts)
	if err != nil {
		// Report status: failed
		r.client.UpdateSandboxStatus(ctx, sandboxName, &GrpcClient.SandboxStatusUpdate{
			Status:  "failed",
			Message: err.Error(),
		})
		return err
	}

	// Report status: starting
	if err := r.client.UpdateSandboxStatus(ctx, sandboxName, &GrpcClient.SandboxStatusUpdate{
		Status:      "starting",
		ContainerID: sb.ContainerID,
		Message:     "Starting container",
	}); err != nil {
		log.Printf("Warning: failed to report starting status: %v", err)
	}

	// Start sandbox
	if err := r.manager.Start(ctx, sb); err != nil {
		r.client.UpdateSandboxStatus(ctx, sandboxName, &GrpcClient.SandboxStatusUpdate{
			Status:  "failed",
			Message: err.Error(),
		})
		return err
	}

	// Report status: running
	if err := r.client.UpdateSandboxStatus(ctx, sandboxName, &GrpcClient.SandboxStatusUpdate{
		Status:      "running",
		ContainerID: sb.ContainerID,
		Message:     "Container is running",
	}); err != nil {
		log.Printf("Warning: failed to report running status: %v", err)
	}

	log.Printf("Sandbox %s created and started successfully", sandboxName)
	return nil
}
```

**Step 2: 修改 handleDeleteJob**

```go
func (r *Runner) handleDeleteJob(job *Job) error {
	ctx := context.Background()

	payload, ok := job.Payload.(map[string]interface{})
	if !ok {
		return fmt.Errorf("invalid job payload")
	}

	sandboxName := payload["sandboxId"].(string)

	// Report status: deleting
	if err := r.client.UpdateSandboxStatus(ctx, sandboxName, &GrpcClient.SandboxStatusUpdate{
		Status:  "deleting",
		Message: "Deleting container",
	}); err != nil {
		log.Printf("Warning: failed to report deleting status: %v", err)
	}

	// Delete sandbox
	if err := r.manager.Delete(ctx, sandboxName); err != nil {
		r.client.UpdateSandboxStatus(ctx, sandboxName, &GrpcClient.SandboxStatusUpdate{
			Status:  "failed",
			Message: err.Error(),
		})
		return err
	}

	log.Printf("Sandbox %s deleted successfully", sandboxName)
	return nil
}
```

**Step 3: 验证编译**

```bash
cd apps/runner && go build ./...
```

**Step 4: Commit**

```bash
git add apps/runner/internal/runner/runner.go
git commit -m "feat: report sandbox status during create and delete operations"
```

---

### Task 4: 完整集成测试

**Files:**
- Modify: `docker/test-runner-status.sh` - 创建状态报告测试脚本

**Step 1: 创建测试脚本**

```bash
#!/bin/bash
# Test Runner Status Reporting

set -e

SERVER_URL="${SERVER_URL:-http://localhost:8080}"

log_info() { echo -e "[INFO] $1"; }
log_error() { echo -e "[ERROR] $1"; }

# Start services
log_info "Starting services..."
docker-compose up -d

# Wait for services
sleep 5

# Create API key
KEY_RESP=$(curl -s -X POST "$SERVER_URL/api/v1/keys" -H "Content-Type: application/json" -d '{"name":"test"}')
API_KEY=$(echo "$KEY_RESP" | grep -o '"key":"[^"]*"' | cut -d'"' -f4)

log_info "API Key: ${API_KEY:0:10}..."

# Create sandbox
SANDBOX_RESP=$(curl -s -X POST "$SERVER_URL/api/v1/sandboxes" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{"name":"status-test","image":"python:3.11-slim"}')

SANDBOX_ID=$(echo "$SANDBOX_RESP" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
log_info "Sandbox ID: $SANDBOX_ID"

# Wait for runner to process
sleep 10

# Check sandbox status
SANDBOX_DETAIL=$(curl -s "$SERVER_URL/api/v1/sandboxes/$SANDBOX_ID")
echo "Sandbox detail: $SANDBOX_DETAIL"

# Verify status is not pending
if echo "$SANDBOX_DETAIL" | grep -q '"status":"pending"'; then
    log_error "Sandbox still pending - status reporting may not be working"
    exit 1
fi

log_info "Status reporting test completed!"
echo ""
echo "Test Results:"
echo "1. Sandbox creation: PASSED"
echo "2. Status reporting: CHECK API RESPONSE ABOVE"
echo ""

# Check runner logs
echo "=== Runner Logs ==="
docker logs codepod-runner --tail=10
```

**Step 2: 运行测试**

```bash
bash docker/test-runner-status.sh
```

**Step 3: Commit**

```bash
git add docker/test-runner-status.sh
git commit -m "test: add runner status reporting test script"
```

---

### Task 5: Docker 镜像更新

**Files:**
- Modify: `docker-compose.yml` - 确保 Runner 使用最新镜像
- Modify: `apps/runner/Dockerfile` - 确保包含最新代码

**Step 1: 重新构建镜像**

```bash
docker-compose build runner
docker-compose up -d
```

**Step 2: 验证运行**

```bash
docker logs codepod-runner --tail=5
```

**Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "chore: update runner image for status reporting"
```

---

## Execution Handoff

**Plan complete and saved to `docs/plans/2026-02-18-runner-status-report.md`. Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
