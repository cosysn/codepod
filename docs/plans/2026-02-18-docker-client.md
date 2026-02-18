# Real Docker Client Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 实现真实的 Docker 客户端，替换 MockClient，使 Runner 能够真正创建和管理带有 Agent 注入的 Sandbox 容器。

**Architecture:** 使用 `github.com/docker/docker/client` 库实现 Docker Client 接口，连接到宿主机的 Docker socket 管理容器生命周期。

**Tech Stack:**
- `github.com/docker/docker v24.0+` (Docker SDK for Go)
- `github.com/docker/docker/api/types` (Container, Image, Network types)
- 标准库: context, net/url

---

### Task 1: 创建 Docker Client 实现

**Files:**
- Create: `apps/runner/pkg/docker/client_real.go`

**Step 1: 创建真实 Docker 客户端**

```go
// apps/runner/pkg/docker/client_real.go
package docker

import (
    "context"
    "fmt"
    "io"
    "net/http"
    "net/url"
    "os"
    "time"

    "github.com/docker/docker/api/types"
    "github.com/docker/docker/api/types/container"
    "github.com/docker/docker/api/types/network"
    "github.com/docker/docker/client"
)

// RealClient is a real Docker client implementation
type RealClient struct {
    cli         *client.Client
    dockerHost  string
}

// NewRealClient creates a new real Docker client
func NewRealClient(dockerHost string) (*RealClient, error) {
    cli, err := client.NewClientWithOpts(
        client.WithHost(dockerHost),
        client.WithAPIVersionNegotiation(),
    )
    if err != nil {
        return nil, fmt.Errorf("failed to create Docker client: %w", err)
    }

    return &RealClient{
        cli:        cli,
        dockerHost: dockerHost,
    }, nil
}

// CreateContainer implements Docker.Client interface
func (r *RealClient) CreateContainer(ctx context.Context, config *ContainerConfig) (string, error) {
    // Convert ContainerConfig to container.Config
    hostConfig := &container.HostConfig{
        Memory:     config.Memory,
        CPUPeriod:  config.CPUPeriod,
        CPUShares: config.CPUShares,
        NetworkMode: container.NetworkMode(config.NetworkMode),
    }

    // Parse memory string to bytes
    memory, err := parseMemoryBytes(config.Memory)
    if err == nil {
        hostConfig.Memory = memory
    }

    // Build environment variables
    env := config.Env

    containerConfig := &container.Config{
        Image:        config.Image,
        Env:          env,
        Cmd:          config.Cmd,
        Entrypoint:   config.Entrypoint,
        Labels:       config.Labels,
    }

    resp, err := r.cli.ContainerCreate(ctx, containerConfig, hostConfig, nil, nil, config.Name)
    if err != nil {
        return "", fmt.Errorf("failed to create container: %w", err)
    }

    return resp.ID, nil
}

// StartContainer implements Docker.Client interface
func (r *RealClient) StartContainer(ctx context.Context, containerID string) error {
    return r.cli.ContainerStart(ctx, containerID, types.ContainerStartOptions{})
}

// StopContainer implements Docker.Client interface
func (r *RealClient) StopContainer(ctx context.Context, containerID string, timeout int) error {
    return r.cli.ContainerStop(ctx, containerID, container.StopOptions{
        Timeout: &timeout,
    })
}

// RemoveContainer implements Docker.Client interface
func (r *RealClient) RemoveContainer(ctx context.Context, containerID string, force bool) error {
    return r.cli.ContainerRemove(ctx, containerID, types.ContainerRemoveOptions{
        Force: force,
    })
}

// ListContainers implements Docker.Client interface
func (r *RealClient) ListContainers(ctx context.Context, all bool) ([]ContainerInfo, error) {
    containers, err := r.cli.ContainerList(ctx, types.ContainerListOptions{All: all})
    if err != nil {
        return nil, fmt.Errorf("failed to list containers: %w", err)
    }

    var result []ContainerInfo
    for _, c := range containers {
        result = append(result, ContainerInfo{
            ID:        c.ID,
            Image:     c.Image,
            Names:     c.Names,
            State:     c.State,
            Status:    c.Status,
            Labels:    c.Labels,
            CreatedAt: c.Created,
        })
    }

    return result, nil
}

// ContainerStatus implements Docker.Client interface
func (r *RealClient) ContainerStatus(ctx context.Context, containerID string) (string, error) {
    info, err := r.cli.ContainerInspect(ctx, containerID)
    if err != nil {
        return "", err
    }
    return info.State.Status, nil
}

// PullImage implements Docker.Client interface
func (r *RealClient) PullImage(ctx context.Context, image string, auth *AuthConfig) error {
    return nil // Docker SDK pulls automatically on ContainerCreate
}

// ImageExists implements Docker.Client interface
func (r *RealClient) ImageExists(ctx context.Context, image string) (bool, error) {
    _, _, err := r.cli.ImageInspectWithRaw(ctx, image)
    if err != nil {
        if client.IsErrNotFound(err) {
            return false, nil
        }
        return false, err
    }
    return true, nil
}

// CreateNetwork implements Docker.Client interface
func (r *RealClient) CreateNetwork(ctx context.Context, name string) (string, error) {
    resp, err := r.cli.NetworkCreate(ctx, name, types.NetworkCreate{
        Driver: "bridge",
    })
    if err != nil {
        return "", fmt.Errorf("failed to create network: %w", err)
    }
    return resp.ID, nil
}

// RemoveNetwork implements Docker.Client interface
func (r *RealClient) RemoveNetwork(ctx context.Context, networkID string) error {
    return r.cli.NetworkRemove(ctx, networkID)
}

// ContainerLogs implements Docker.Client interface
func (r *RealClient) ContainerLogs(ctx context.Context, containerID string, follow bool) (io.ReadCloser, error) {
    logs, err := r.cli.ContainerLogs(ctx, containerID, types.ContainerLogsOptions{
        Follow: follow,
        ShowStdout: true,
        ShowStderr: true,
    })
    if err != nil {
        return nil, fmt.Errorf("failed to get logs: %w", err)
    }
    return logs, nil
}

// parseMemoryBytes parses memory string to bytes
func parseMemoryBytes(mem string) (int64, error) {
    if mem == "" {
        return 512 * 1024 * 1024, nil // Default 512MB
    }

    var multiplier int64 = 1
    switch {
    case len(mem) >= 2 && mem[len(mem)-2:] == "Mi":
        multiplier = 1024 * 1024
    case len(mem) >= 2 && mem[len(mem)-2:] == "Gi":
        multiplier = 1024 * 1024 * 1024
    case len(mem) >= 1 && mem[len(mem)-1:] == "M":
        multiplier = 1024 * 1024
    case len(mem) >= 1 && mem[len(mem)-1:] == "G":
        multiplier = 1024 * 1024 * 1024
    }

    var value int64
    fmt.Sscanf(mem[:len(mem)-1], "%d", &value)
    return value * multiplier, nil
}
```

**Step 2: 验证编译**

Run: `cd /home/ubuntu/codepod/apps/runner && go build ./pkg/docker/...`
Expected: PASS (may need go.mod update)

**Step 3: Commit**

```bash
git add apps/runner/pkg/docker/client_real.go
git commit -m "feat: add real Docker client implementation"
```

---

### Task 2: 更新 Runner 使用真实 Docker Client

**Files:**
- Modify: `apps/runner/internal/runner/runner.go`

**Step 1: 更新 Runner 创建逻辑**

```go
// apps/runner/internal/runner/runner.go

import (
    "github.com/codepod/codepod/apps/runner/pkg/config"
    "github.com/codepod/codepod/apps/runner/pkg/docker"
    "github.com/codepod/codepod/apps/runner/pkg/sandbox"
)

type Runner struct {
    cfg     *config.Config
    docker  docker.Client
    manager *sandbox.Manager
    stopChan chan struct{}
}

func New() (*Runner, error) {
    cfg := config.LoadFromEnv()

    // Create real Docker client
    dockerClient, err := docker.NewRealClient(cfg.Docker.Host)
    if err != nil {
        return nil, fmt.Errorf("failed to create Docker client: %w", err)
    }

    manager := sandbox.NewManager(dockerClient)

    return &Runner{
        cfg:     cfg,
        docker:  dockerClient,
        manager: manager,
        stopChan: make(chan struct{}),
    }, nil
}
```

**Step 2: 验证编译**

Run: `cd /home/ubuntu/codepod/apps/runner && go build ./...`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/runner/internal/runner/runner.go
git commit -m "feat: update runner to use real Docker client"
```

---

### Task 3: 添加 Docker Client 工厂函数

**Files:**
- Modify: `apps/runner/pkg/docker/client.go`

**Step 1: 添加 NewClient 工厂函数**

```go
// apps/runner/pkg/docker/client.go

// NewClient creates a Docker client based on configuration
// If dockerHost is empty or "mock", returns a MockClient
func NewClient(dockerHost string) (Client, error) {
    if dockerHost == "" || dockerHost == "mock" {
        return NewMockClient(), nil
    }

    // Check if we should use mock for testing
    if os.Getenv("USE_MOCK_DOCKER") == "true" {
        return NewMockClient(), nil
    }

    return NewRealClient(dockerHost)
}
```

**Step 2: 验证编译**

Run: `cd /home/ubuntu/codepod/apps/runner && go build ./...`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/runner/pkg/docker/client.go
git commit -m "feat: add Docker client factory function"
```

---

### Task 4: 更新 go.mod 添加 Docker 依赖

**Files:**
- Modify: `apps/runner/go.mod`

**Step 1: 添加 Docker SDK 依赖**

```bash
cd /home/ubuntu/codepod/apps/runner
go get github.com/docker/docker@v24.0.0
go mod tidy
```

**Step 2: 验证编译**

Run: `go build ./...`
Expected: PASS

**Step 3: Commit**

```bash
git add go.mod go.sum
git commit -m "chore: add Docker SDK dependency"
```

---

### Task 5: 端到端测试

**Files:**
- Create: `docker/test-agent-injection.sh`

**Step 1: 创建测试脚本**

```bash
#!/bin/bash

# Test Agent injection into sandbox container

set -e

NETWORK="codepod-network"
IMAGE="codepod/agent:latest"

# Create network
docker network create ${NETWORK} 2>/dev/null || true

# Run agent container
CONTAINER_ID=$(docker run -d \
    --name test-agent \
    --network ${NETWORK} \
    -e AGENT_TOKEN=test-token \
    -e AGENT_SANDBOX_ID=test-sandbox \
    ${IMAGE})

echo "Container started: ${CONTAINER_ID}"

# Wait for startup
sleep 3

# Check if container is running
STATUS=$(docker inspect -f '{{.State.Status}}' ${CONTAINER_ID})
echo "Container status: ${STATUS}"

# Check logs
LOGS=$(docker logs ${CONTAINER_ID} 2>&1 | tail -10)
echo "Logs: ${LOGS}"

# Cleanup
docker stop ${CONTAINER_ID} >/dev/null
docker rm ${CONTAINER_ID} >/dev/null
docker network rm ${NETWORK} >/dev/null 2>/dev/null || true

echo "Test completed!"
```

**Step 2: 运行测试**

```bash
chmod +x docker/test-agent-injection.sh
./docker/test-agent-injection.sh
```

**Step 3: Commit**

```bash
git add docker/test-agent-injection.sh
git commit -m "test: add agent injection E2E test"
```

---

## Execution Handoff

**Plan complete and saved to `docs/plans/2026-02-18-docker-client.md`. Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
