# Agent Injection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 Agent 二进制注入到 Sandbox 容器，类似 Daytona 的三阶段流程：二进制拷贝 → Entrypoint 劫持 → 反向隧道。

**Architecture:**
1. Runner 构建 agent 二进制
2. 创建容器时使用 Docker API 的 CopyToContainer 将二进制拷贝到容器
3. 修改容器 Entrypoint 使 agent 成为 PID 1
4. Agent 启动后通过 gRPC 连接到 Server 建立反向隧道

**Tech Stack:**
- `github.com/docker/docker/client` - Docker SDK for Go
- `io.Copy` - 文件拷贝到容器

---

### Task 1: 构建 Agent 二进制

**Files:**
- Create: `scripts/build-agent.sh`

**Step 1: 创建构建脚本**

```bash
#!/bin/bash
# scripts/build-agent.sh

set -e

OUTPUT_DIR="${1:-./bin}"
mkdir -p ${OUTPUT_DIR}

echo "Building agent for linux/amd64..."
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o ${OUTPUT_DIR}/agent ./apps/agent/cmd

echo "Building agent for linux/arm64..."
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -o ${OUTPUT_DIR}/agent-arm64 ./apps/agent/cmd

echo "Agent binaries built:"
ls -la ${OUTPUT_DIR}/agent*
```

**Step 2: 创建目录并保存脚本**

```bash
mkdir -p scripts
# 保存上面的脚本到 scripts/build-agent.sh
chmod +x scripts/build-agent.sh
```

**Step 3: 测试构建**

```bash
./scripts/build-agent.sh
```

**Step 4: Commit**

```bash
git add scripts/build-agent.sh
git commit -m "script: add agent build script"
```

---

### Task 2: 添加 Agent 注入方法到 Docker Client

**Files:**
- Modify: `apps/runner/pkg/docker/client.go` - 添加接口方法
- Modify: `apps/runner/pkg/docker/client_real.go` - 实现 CopyToContainer

**Step 1: 添加接口方法到 client.go**

在 Client 接口中添加方法:

```go
// CopyFileToContainer copies a file to the container
CopyFileToContainer(ctx context.Context, containerID, destPath string, content io.Reader) error
```

**Step 2: 实现方法到 client_real.go**

在 RealClient 结构体后添加:

```go
// CopyFileToContainer copies a file to the container
func (r *RealClient) CopyFileToContainer(ctx context.Context, containerID, destPath string, content io.Reader) error {
	err := r.cli.CopyToContainer(ctx, containerID, destPath, content, types.CopyToContainerOptions{
		AllowOverwriteDirWithFile: true,
	})
	if err != nil {
		return fmt.Errorf("failed to copy file to container: %w", err)
	}
	return nil
}
```

**Step 3: 添加 io import**

确保 client_real.go 有:
```go
import (
	// ... existing
	"io"
	"bytes"
)
```

**Step 4: 验证编译**

```bash
cd apps/runner && go build ./pkg/docker/...
```

**Step 5: Commit**

```bash
git add pkg/docker/client.go pkg/docker/client_real.go
git commit -m "feat: add CopyToContainer method to Docker client"
```

---

### Task 3: 修改 Sandbox Manager 支持 Agent 注入

**Files:**
- Modify: `apps/runner/pkg/sandbox/manager.go`

**Step 1: 添加 AgentBinaryPath 到 Config**

在 CreateOptions 中添加:

```go
type CreateOptions struct {
	// ... existing fields
	AgentBinaryPath string  // Path to agent binary
	AgentToken     string  // Token for agent to connect to server
	AgentServerURL string  // Server URL for agent to connect
}
```

**Step 2: 修改 Create 方法实现注入**

在 Create 函数中，容器创建后添加:

```go
func (m *Manager) Create(ctx context.Context, opts *CreateOptions) (*Sandbox, error) {
	// ... existing create logic ...

	// If agent binary path is provided, inject it
	if opts.AgentBinaryPath != "" {
		// Read agent binary
		agentContent, err := os.ReadFile(opts.AgentBinaryPath)
		if err != nil {
			return nil, fmt.Errorf("failed to read agent binary: %w", err)
		}

		// Copy agent binary to container
		err = m.docker.CopyFileToContainer(ctx, containerID, "/tmp/agent", bytes.NewReader(agentContent))
		if err != nil {
			return nil, fmt.Errorf("failed to copy agent to container: %w", err)
		}

		// Make agent executable
		execResp, err := m.docker.ExecCreate(ctx, containerID, []string{"chmod", "+x", "/tmp/agent"})
		if err != nil {
			return nil, fmt.Errorf("failed to chmod agent: %w", err)
		}

		// Set environment variables for agent
		env = append(env, "AGENT_TOKEN="+opts.AgentToken)
		env = append(env, "AGENT_SERVER_URL="+opts.AgentServerURL)

		// Override entrypoint to run agent
		config.Entrypoint = []string{"/tmp/agent", "start"}
	}

	// ... rest of create
}
```

**Step 3: 添加 os/bytes imports**

确保 import 有:
```go
import (
	"os"
	"bytes"
)
```

**Step 4: 验证编译**

```bash
cd apps/runner && go build ./...
```

**Step 5: Commit**

```bash
git add pkg/sandbox/manager.go
git commit -m "feat: add agent injection support to sandbox manager"
```

---

### Task 4: 添加 ExecCreate 方法（可选）

如果需要 chmod，需要添加 Exec 方法。

**Files:**
- Modify: `apps/runner/pkg/docker/client.go`
- Modify: `apps/runner/pkg/docker/client_real.go`

**Step 1: 添加 Exec 接口**

```go
// ExecCreate creates an exec instance in the container
ExecCreate(ctx context.Context, containerID string, cmd []string) (string, error)
```

**Step 2: 实现 ExecCreate**

```go
func (r *RealClient) ExecCreate(ctx context.Context, containerID string, cmd []string) (string, error) {
	resp, err := r.cli.ContainerExecCreate(ctx, containerID, types.ExecConfig{
		Cmd:          cmd,
		AttachStdout: true,
		AttachStderr: true,
	})
	if err != nil {
		return "", err
	}
	return resp.ID, nil
}
```

**Step 3: Commit**

```bash
git add pkg/docker/client.go pkg/docker/client_real.go
git commit -m "feat: add exec create method to Docker client"
```

---

### Task 5: 创建 Agent 注入 E2E 测试

**Files:**
- Create: `apps/runner/e2e/agent_injection_test.go`

**Step 1: 编写测试**

```go
package e2e

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/codepod/codepod/apps/runner/pkg/docker"
	"github.com/codepod/codepod/apps/runner/pkg/sandbox"
)

const (
	testImage     = "alpine:3.19"  // Use minimal image for testing
	testNetwork   = "codepod-e2e-test"
	testToken     = "test-token-12345"
	testSandboxID = "e2e-agent-test"
)

// TestAgentInjection tests agent binary injection into container
func TestAgentInjection(t *testing.T) {
	ctx := context.Background()

	if os.Getenv("E2E_TEST") != "true" {
		t.Skip("Skipping E2E test. Set E2E_TEST=true to run.")
	}

	// Get agent binary path
	agentPath := os.Getenv("AGENT_BINARY_PATH")
	if agentPath == "" {
		t.Fatal("AGENT_BINARY_PATH not set")
	}

	// Create Docker client
	dockerHost := os.Getenv("CODEPOD_DOCKER_HOST")
	if dockerHost == "" {
		dockerHost = "unix:///var/run/docker.sock"
	}

	dockerClient, err := docker.NewClient(dockerHost)
	if err != nil {
		t.Fatalf("Failed to create Docker client: %v", err)
	}

	// Create network
	networkID, err := dockerClient.CreateNetwork(ctx, testNetwork)
	if err != nil {
		t.Logf("Network might already exist: %v", err)
	}

	defer func() {
		if networkID != "" {
			dockerClient.RemoveNetwork(ctx, networkID)
		}
	}()

	// Create sandbox with agent injection
	manager := sandbox.NewManager(dockerClient)
	opts := &sandbox.CreateOptions{
		Name:            testSandboxID,
		Image:           testImage,
		NetworkMode:     "host",
		AgentBinaryPath: agentPath,
		AgentToken:      testToken,
		AgentServerURL:  "http://localhost:8080",
		Env: map[string]string{
			"TEST": "value",
		},
	}

	sb, err := manager.Create(ctx, opts)
	if err != nil {
		t.Fatalf("Failed to create sandbox: %v", err)
	}

	// Cleanup
	defer func() {
		dockerClient.StopContainer(ctx, sb.ContainerID, 10)
		dockerClient.RemoveContainer(ctx, sb.ContainerID, true)
	}()

	// Start sandbox
	if err := manager.Start(ctx, sb); err != nil {
		t.Fatalf("Failed to start sandbox: %v", err)
	}

	// Wait for container to start
	time.Sleep(2 * time.Second)

	// Verify container is running
	status, err := dockerClient.ContainerStatus(ctx, sb.ContainerID)
	if err != nil {
		t.Fatalf("Failed to get container status: %v", err)
	}
	if status != "running" {
		logs, _ := dockerClient.ContainerLogs(ctx, sb.ContainerID, false)
		t.Logf("Container logs: %s", logs)
		t.Fatalf("Container not running, status: %s", status)
	}

	// Check if agent binary exists in container
	// (We can't easily verify this without exec, but the test ensures no errors)
	t.Logf("Agent injected successfully, container running: %s", sb.ContainerID)
}
```

**Step 2: 验证编译**

```bash
cd apps/runner && go build ./e2e/...
```

**Step 3: Commit**

```bash
git add e2e/agent_injection_test.go
git commit -m "test: add agent injection E2E test"
```

---

## Execution Handoff

**Plan complete and saved to `docs/plans/2026-02-18-agent-injection.md`. Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
