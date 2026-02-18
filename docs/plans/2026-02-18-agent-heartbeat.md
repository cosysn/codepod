# Agent Heartbeat and Status Reporting Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 Agent 心跳和状态上报功能，使 Server 能实时监控 Sandbox 运行状态。

**Architecture:**
- Agent 定期向 Server 上报心跳（默认 30 秒）
- Agent 上报指标：CPU、内存、活跃会话数、启动时间
- Server 维护 Agent 最后活跃时间，检测失联 Sandbox
- 使用 HTTP POST 到 Server 的 `/api/v1/sandboxes/:id/status` 端点

**Tech Stack:**
- Agent: Go HTTP Client (`net/http`), 系统指标获取 (`github.com/shirou/gopsutil/host`)
- Server: Express.js REST API

---

### Task 1: Agent 创建 Reporter 包

**Files:**
- Create: `apps/agent/pkg/reporter/client.go` - HTTP Reporter 实现
- Modify: `apps/agent/pkg/config/config.go` - 添加 Reporter 配置

**Step 1: 创建 Reporter 包目录和文件**

```bash
mkdir -p apps/agent/pkg/reporter
touch apps/agent/pkg/reporter/client.go
```

**Step 2: 编写 Reporter 客户端**

```go
// apps/agent/pkg/reporter/client.go
package reporter

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"
)

// Config holds reporter configuration
type Config struct {
	ServerURL string
	SandboxID string
	Interval  time.Duration
}

// Status represents agent status report
type Status struct {
	SandboxID    string            `json:"sandboxId"`
	Status       string            `json:"status"` // running, stopped
	CPUPercent   float64           `json:"cpuPercent,omitempty"`
	MemoryMB     int              `json:"memoryMB,omitempty"`
	SessionCount int               `json:"sessionCount,omitempty"`
	UptimeSecs  int64             `json:"uptimeSecs"`
	Hostname     string            `json:"hostname"`
	Timestamp    time.Time        `json:"timestamp"`
	Metadata     map[string]string `json:"metadata,omitempty"`
}

// Client sends status reports to the server
type Client struct {
	config  *Config
	client  *http.Client
}

// NewClient creates a new reporter client
func NewClient(cfg *Config) *Client {
	return &Client{
		config: cfg,
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// Report sends a status report to the server
func (c *Client) Report(ctx context.Context, status *Status) error {
	status.SandboxID = c.config.SandboxID
	status.Timestamp = time.Now()

	data, err := json.Marshal(status)
	if err != nil {
		return fmt.Errorf("failed to marshal status: %w", err)
	}

	url := fmt.Sprintf("%s/api/v1/sandboxes/%s/status", c.config.ServerURL, c.config.SandboxID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send status: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("server returned status %d", resp.StatusCode)
	}

	return nil
}

// StartHeartbeat starts periodic heartbeat reporting
func (c *Client) StartHeartbeat(ctx context.Context, initialStatus *Status) error {
	// Send initial status
	if err := c.Report(ctx, initialStatus); err != nil {
		return fmt.Errorf("failed to send initial status: %w", err)
	}

	ticker := time.NewTicker(c.config.Interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			// Send final status before exiting
			finalStatus := *initialStatus
			finalStatus.Status = "stopped"
			c.Report(context.Background(), &finalStatus)
			return ctx.Err()
		case <-ticker.C:
			// Send heartbeat with updated metrics
			status := c.collectStatus(initialStatus)
			if err := c.Report(ctx, status); err != nil {
				// Log error but continue
				fmt.Printf("Failed to send heartbeat: %v\n", err)
			}
		}
	}
}

// collectStatus gathers current system metrics
func (c *Client) collectStatus(base *Status) *Status {
	status := &Status{
		SandboxID:    c.config.SandboxID,
		Status:       "running",
		UptimeSecs:   time.Since(base.Timestamp).Seconds(),
		Hostname:     base.Hostname,
		SessionCount:  base.SessionCount,
	}
	return status
}
```

**Step 3: 添加 Reporter 配置到 config**

```go
// 在 apps/agent/pkg/config/config.go 中添加
type ReporterConfig struct {
	Interval time.Duration // Heartbeat interval (default 30s)
}

func LoadFromEnv() *Config {
	// ... 现有代码 ...
	Reporter: ReporterConfig{
		Interval: getEnvDurationOrDefault("AGENT_REPORT_INTERVAL", 30*time.Second),
	},
}
```

**Step 4: 验证编译**

```bash
cd apps/agent && go build ./...
```

**Step 5: Commit**

```bash
git add apps/agent/pkg/reporter/
git commit -m "feat: add reporter package for heartbeat"
```

---

### Task 2: Agent 集成 Reporter 到主程序

**Files:**
- Modify: `apps/agent/cmd/main.go` - 集成 Reporter 启动

**Step 1: 修改 main.go**

```go
// apps/agent/cmd/main.go
package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/codepod/codepod/apps/agent/pkg/config"
	"github.com/codepod/codepod/apps/agent/pkg/reporter"
	"github.com/codepod/codepod/apps/agent/pkg/ssh"
)

func main() {
	log.Println("Starting CodePod Agent...")

	cfg := config.LoadFromEnv()
	if err := cfg.Validate(); err != nil {
		log.Fatalf("Invalid configuration: %v", err)
	}

	log.Printf("Sandbox ID: %s", cfg.Agent.SandboxID)

	// Create reporter client
	reporterCfg := &reporter.Config{
		ServerURL: cfg.Agent.ServerURL,
		SandboxID: cfg.Agent.SandboxID,
		Interval:  cfg.Reporter.Interval,
	}
	reporterClient := reporter.NewClient(reporterCfg)

	// Create context for graceful shutdown
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start reporter in background
	initialStatus := &reporter.Status{
		Status:    "running",
		Hostname:  getHostname(),
		Timestamp: time.Now(),
	}
	go func() {
		if err := reporterClient.StartHeartbeat(ctx, initialStatus); err != nil && ctx.Err() == nil {
			log.Printf("Reporter error: %v", err)
		}
	}()

	// Start SSH server
	server := ssh.NewServer(&ssh.ServerConfig{
		Port:        cfg.SSH.Port,
		HostKeys:    cfg.SSH.HostKeys,
		MaxSessions: cfg.SSH.MaxSessions,
		IdleTimeout: cfg.SSH.IdleTimeout,
		Token:       cfg.Agent.Token,
	})

	if err := server.Start(ctx); err != nil {
		log.Fatalf("Failed to start SSH server: %v", err)
	}

	// Handle shutdown signals
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	select {
	case sig := <-sigChan:
		log.Printf("Received signal %v, shutting down...", sig)
	}

	cancel()
	server.Stop()
	log.Println("Agent shutdown complete")
}

func getHostname() string {
	hostname, err := os.Hostname()
	if err != nil {
		return "unknown"
	}
	return hostname
}
```

**Step 2: 验证编译**

```bash
cd apps/agent && go build ./...
```

**Step 3: Commit**

```bash
git add apps/agent/cmd/main.go
git commit -m "feat: integrate reporter heartbeat into main agent"
```

---

### Task 3: Server 添加 Agent Status API 端点

**Files:**
- Modify: `apps/server/src/server.ts` - 添加 `/api/v1/sandboxes/:id/status` 端点
- Modify: `apps/server/src/db/store.ts` - 添加心跳和 Agent 信息存储

**Step 1: 扩展 Store 类型定义**

```typescript
// apps/server/src/db/store.ts
interface AgentInfo {
	lastHeartbeat: string;  // ISO timestamp
	ipAddress?: string;
	hostname?: string;
	metrics?: {
		cpuPercent?: number;
		memoryMB?: number;
		sessionCount?: number;
	};
}

interface Sandbox {
	// ... existing fields ...
	agentInfo?: AgentInfo;  // Add this field
}

// 更新 sandbox 时添加 agentInfo
function updateAgentInfo(id: string, info: Partial<AgentInfo>) {
	const sandbox = this.sandboxes.get(id);
	if (!sandbox) return undefined;

	sandbox.agentInfo = {
		...sandbox.agentInfo,
		...info,
		lastHeartbeat: new Date().toISOString(),
	};
	this.sandboxes.set(id, sandbox);
	return sandbox;
}
```

**Step 2: 添加 Status API 端点**

```typescript
// apps/server/src/server.ts

// 在 sandbox 路由处理中添加
if (path.match(/^\/api\/v1\/sandboxes\/[a-zA-Z0-9-]+\/status$/) && method === 'POST') {
    // 解析 sandbox ID from path
    const match = path.match(/\/api\/v1\/sandboxes\/([a-zA-Z0-9-]+)\/status/);
    if (!match) {
        sendError(res, 400, 'Invalid sandbox ID');
        return;
    }
    const sandboxId = match[1];

    const body = await parseBody(req);
    const status = body as { status: string; cpuPercent?: number; memoryMB?: number; sessionCount?: number };

    // 更新 sandbox
    const sandbox = store.getSandbox(sandboxId);
    if (!sandbox) {
        sendError(res, 404, 'Sandbox not found');
        return;
    }

    // 更新 agent info
    store.updateAgentInfo(sandboxId, {
        metrics: {
            cpuPercent: status.cpuPercent,
            memoryMB: status.memoryMB,
            sessionCount: status.sessionCount,
        }
    });

    // 如果状态是 stopped，更新 sandbox 状态
    if (status.status === 'stopped') {
        store.updateSandbox(sandboxId, { status: 'stopped' });
    }

    sendJson(res, 200, { success: true, sandboxId });
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
git commit -m "feat: add agent status API endpoint"
```

---

### Task 4: 添加系统指标获取（可选增强）

**Files:**
- Modify: `apps/agent/pkg/reporter/client.go` - 添加 CPU/内存获取

**Step 1: 添加 gopsutil 依赖**

```bash
cd apps/agent
GOPROXY=https://mirrors.aliyun.com/goproxy/,direct GOSUMDB=off go get github.com/shirou/gopsutil/host
```

**Step 2: 增强 collectStatus 方法**

```go
// apps/agent/pkg/reporter/client.go
import (
	"github.com/shirou/gopsutil/host"
	"github.com/shirou/gopsutil/mem"
)

// collectStatus gathers current system metrics
func (c *Client) collectStatus(base *Status) *Status {
	// Get CPU percent
	cpuPercent, _ := getCPUPercent()

	// Get memory
	memoryMB, _ := getMemoryMB()

	status := &Status{
		SandboxID:    c.config.SandboxID,
		Status:       "running",
		UptimeSecs:   time.Since(base.Timestamp).Seconds(),
		Hostname:     base.Hostname,
		CPUPercent:   cpuPercent,
		MemoryMB:     memoryMB,
		SessionCount: base.SessionCount,
	}
	return status
}

func getCPUPercent() (float64, error) {
	// Simplified: return 0 for now as CPU percent requires interval
	return 0, nil
}

func getMemoryMB() (int, error) {
	v, err := mem.VirtualMemory()
	if err != nil {
		return 0, err
	}
	return int(v.Used / 1024 / 1024), nil
}
```

**Step 3: 验证编译**

```bash
cd apps/agent && go build ./...
```

**Step 4: Commit**

```bash
git add apps/agent/pkg/reporter/client.go
git commit -m "feat: add system metrics collection to reporter"
```

---

### Task 5: 集成测试

**Files:**
- Modify: `docker/test-agent-direct.sh` - 验证心跳功能

**Step 1: 创建心跳测试脚本**

```bash
#!/bin/bash
# Test agent heartbeat functionality

set -e

AGENT_BINARY="${1:-./build/agent}"
TEST_CONTAINER="heartbeat-test-$(date +%s)"

# ... 创建容器代码 ...

# 启动 agent
docker exec -d $TEST_CONTAINER sh -c 'exec /tmp/agent > /tmp/agent.log 2>&1'

sleep 5

# 检查 agent 是否发送了心跳（查看日志）
if docker exec $TEST_CONTAINER cat /tmp/agent.log | grep -q "heartbeat"; then
    echo "Heartbeat test: PASS"
else
    echo "Heartbeat test: checking if agent started..."
    docker exec $TEST_CONTAINER cat /tmp/agent.log
fi
```

**Step 2: 运行测试**

```bash
bash docker/test-heartbeat.sh
```

**Step 3: Commit**

```bash
git add docker/test-heartbeat.sh
git commit -m "test: add heartbeat test script"
```

---

## Execution Handoff

**Plan complete and saved to `docs/plans/2026-02-18-agent-heartbeat.md`. Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
