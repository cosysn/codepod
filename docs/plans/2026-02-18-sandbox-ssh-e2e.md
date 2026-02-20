# Sandbox E2E Test with SSH Connection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create end-to-end test that creates a sandbox, waits for it to be ready, and connects via SSH to verify the Agent is running correctly.

**Architecture:**
1. Use docker SDK to create and start a sandbox container with agent image
2. Wait for container to be running and SSH port to be available
3. Use SSH client to connect with the agent token
4. Execute a test command and verify output
5. Cleanup container

**Tech Stack:**
- Go: `golang.org/x/crypto/ssh` for SSH client
- Docker SDK: `github.com/docker/docker` for container management
- Shell: bash for orchestration

---

### Task 1: Create SSH Test Helper Package

**Files:**
- Create: `apps/runner/e2e/ssh_test.go`

**Step 1: Create test directory**

```bash
mkdir -p apps/runner/e2e
```

**Step 2: Write SSH test client**

```go
// apps/runner/e2e/ssh_test.go
package e2e

import (
	"context"
	"fmt"
	"net"
	"time"

	"golang.org/x/crypto/ssh"
)

// SSHClient represents an SSH connection to a sandbox
type SSHClient struct {
	client *ssh.Client
}

// Connect attempts SSH connection with retries
func Connect(host string, port int, user, password string, retries int) (*SSHClient, error) {
	var lastErr error

	for i := 0; i < retries; i++ {
		// First check if port is open
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", host, port), 2*time.Second)
		if err == nil {
			conn.Close()
		} else {
			time.Sleep(2 * time.Second)
			continue
		}

		// Try SSH connection
		config := &ssh.ClientConfig{
			User: user,
			Auth: []ssh.AuthMethod{
				ssh.Password(password),
			},
			HostKeyCallback: ssh.InsecureIgnoreHostKey(),
			Timeout:         10 * time.Second,
		}

		client, err := ssh.Dial("tcp", fmt.Sprintf("%s:%d", host, port), config)
		if err == nil {
			return &SSHClient{client: client}, nil
		}
		lastErr = err
		time.Sleep(2 * time.Second)
	}
	return nil, fmt.Errorf("failed to connect after %d retries: %w", retries, lastErr)
}

// Run executes a command and returns output
func (s *SSHClient) Run(cmd string) (string, error) {
	session, err := s.client.NewSession()
	if err != nil {
		return "", err
	}
	defer session.Close()

	output, err := session.CombinedOutput(cmd)
	return string(output), err
}

// Close closes the SSH connection
func (s *SSHClient) Close() error {
	return s.client.Close()
}
```

**Step 3: Verify it compiles**

Run: `cd /home/ubuntu/codepod/apps/runner && go build ./e2e/...`
Expected: PASS

**Step 4: Commit**

```bash
git add e2e/
git commit -m "test: add SSH client for E2E tests"
```

---

### Task 2: Create Sandbox E2E Test

**Files:**
- Create: `apps/runner/e2e/sandbox_test.go`

**Step 1: Write the failing test**

```go
// apps/runner/e2e/sandbox_test.go
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
	testImage     = "codepod/agent:latest"
	testNetwork   = "codepod-e2e-test"
	testToken     = "test-token-12345"
	testSandboxID = "e2e-test-sandbox"
)

// TestSandboxSSHConnection tests creating a sandbox and connecting via SSH
func TestSandboxSSHConnection(t *testing.T) {
	ctx := context.Background()

	// Skip if not in E2E mode
	if os.Getenv("E2E_TEST") != "true" {
		t.Skip("Skipping E2E test. Set E2E_TEST=true to run.")
	}

	// Create Docker client (use real client, not mock)
	dockerHost := os.Getenv("CODEPOD_DOCKER_HOST")
	if dockerHost == "" {
		dockerHost = "unix:///var/run/docker.sock"
	}

	dockerClient, err := docker.NewClient(dockerHost)
	if err != nil {
		t.Fatalf("Failed to create Docker client: %v", err)
	}

	// Create network for test
	networkID, err := dockerClient.CreateNetwork(ctx, testNetwork)
	if err != nil {
		t.Logf("Network might already exist: %v", err)
	}

	// Cleanup network on exit
	defer func() {
		if networkID != "" {
			dockerClient.RemoveNetwork(ctx, networkID)
		}
	}()

	// Create sandbox
	manager := sandbox.NewManager(dockerClient)
	opts := &sandbox.CreateOptions{
		Name:  testSandboxID,
		Image: testImage,
		Env: []string{
			"AGENT_TOKEN=" + testToken,
			"AGENT_SANDBOX_ID=" + testSandboxID,
		},
		Resources: &sandbox.Resources{
			Memory: "512MB",
			CPU:    1,
		},
	}

	sb, err := manager.Create(ctx, opts)
	if err != nil {
		t.Fatalf("Failed to create sandbox: %v", err)
	}

	// Cleanup container on exit
	defer func() {
		dockerClient.StopContainer(ctx, sb.ContainerID, 10)
		dockerClient.RemoveContainer(ctx, sb.ContainerID, true)
	}()

	// Start sandbox
	if err := manager.Start(ctx, sb); err != nil {
		t.Fatalf("Failed to start sandbox: %v", err)
	}

	// Wait for SSH to be ready (container needs to start SSH server)
	t.Logf("Waiting for sandbox to be ready...")
	time.Sleep(5 * time.Second)

	// Verify container is running
	status, err := dockerClient.ContainerStatus(ctx, sb.ContainerID)
	if err != nil {
		t.Fatalf("Failed to get container status: %v", err)
	}
	if status != "running" {
		t.Fatalf("Container not running, status: %s", status)
	}

	// Get container info to find mapped port
	containers, err := dockerClient.ListContainers(ctx, true)
	if err != nil {
		t.Fatalf("Failed to list containers: %v", err)
	}

	var containerPort int
	for _, c := range containers {
		if c.ID == sb.ContainerID && len(c.Ports) > 0 {
			containerPort = c.Ports[0].ContainerPort
			break
		}
	}

	// For direct container access, use bridge network IP
	// In this test, we connect to the container directly via its IP
	host := "localhost" // For now, we'll use host network mode
	port := 22

	// Connect via SSH
	sshClient, err := Connect(host, port, "root", testToken, 10)
	if err != nil {
		// Print container logs for debugging
		logs, _ := dockerClient.ContainerLogs(ctx, sb.ContainerID, false)
		t.Logf("Container logs: %s", logs)
		t.Fatalf("Failed to connect via SSH: %v", err)
	}
	defer sshClient.Close()

	// Run test command
	output, err := sshClient.Run("echo 'Hello from sandbox'")
	if err != nil {
		t.Fatalf("Failed to run command: %v", err)
	}

	if !strings.Contains(output, "Hello from sandbox") {
		t.Errorf("Unexpected output: %s", output)
	}

	t.Logf("SSH test successful! Output: %s", output)
}
```

**Step 2: Run test to verify it compiles**

Run: `cd /home/ubuntu/codepod/apps/runner && go build ./e2e/...`
Expected: PASS (or missing ssh package)

**Step 3: Add SSH dependency**

```bash
cd /home/ubuntu/codepod/apps/runner
GOSUMDB=off go get golang.org/x/crypto/ssh@latest
```

**Step 4: Run test to verify it compiles**

Run: `cd /home/ubuntu/codepod/apps/runner && go build ./e2e/...`
Expected: PASS

**Step 5: Commit**

```bash
git add e2e/
git commit -m "test: add sandbox E2E test with SSH connection"
```

---

### Task 3: Add Network Configuration for Container Access

**Files:**
- Modify: `apps/runner/pkg/sandbox/manager.go`

**Step 1: Add host network mode option**

```go
// In CreateOptions, add:
type CreateOptions struct {
	// ... existing fields
	NetworkMode string // "bridge", "host", or network name
}
```

**Step 2: Pass network mode to Docker client**

```go
// In manager.go Create function, use opts.NetworkMode
if opts.NetworkMode == "" {
	opts.NetworkMode = "bridge"
}
config.NetworkMode = opts.NetworkMode
```

**Step 3: Verify compilation**

Run: `go build ./...`
Expected: PASS

**Step 4: Commit**

```bash
git add pkg/sandbox/
git commit -m "feat: add network mode option for sandbox"
```

---

### Task 4: Update E2E Test for Proper SSH Access

**Files:**
- Modify: `apps/runner/e2e/sandbox_test.go`

**Step 1: Modify test to use host network mode**

```go
opts := &sandbox.CreateOptions{
	Name:         testSandboxID,
	Image:        testImage,
	NetworkMode:  "host", // Use host network for direct port 22 access
	Env: []string{
		"AGENT_TOKEN=" + testToken,
		"AGENT_SANDBOX_ID=" + testSandboxID,
	},
	Resources: &sandbox.Resources{
		Memory: "512MB",
		CPU:    1,
	},
}
```

**Step 2: Update connection logic**

```go
// Use localhost:22 for host network mode
host := "127.0.0.1"
port := 22
```

**Step 3: Run test to verify**

Run: `cd /home/ubuntu/codepod/apps/runner && go build ./e2e/...`
Expected: PASS

**Step 4: Commit**

```bash
git add e2e/
git commit -m "test: update E2E test for host network mode"
```

---

### Task 5: Create Shell Test Script

**Files:**
- Create: `docker/test-sandbox-ssh.sh`

**Step 1: Create test script**

```bash
#!/bin/bash

# Sandbox SSH E2E Test Script
# Creates a sandbox, connects via SSH, runs a command

set -e

IMAGE="${CODEPOD_IMAGE:-codepod/agent:latest}"
TOKEN="${AGENT_TOKEN:-test-token-12345}"
SANDBOX_ID="e2e-test-$(date +%s)"

echo "=== Sandbox SSH E2E Test ==="
echo "Image: $IMAGE"
echo "Sandbox ID: $SANDBOX_ID"

# Cleanup function
cleanup() {
    echo "[Cleanup] Stopping and removing container..."
    docker stop ${SANDBOX_ID} >/dev/null 2>&1 || true
    docker rm -f ${SANDBOX_ID} >/dev/null 2>&1 || true
}

trap cleanup EXIT

# Run sandbox container
echo "[1/4] Starting sandbox container..."
CONTAINER_ID=$(docker run -d \
    --name ${SANDBOX_ID} \
    --network host \
    -e AGENT_TOKEN=${TOKEN} \
    -e AGENT_SANDBOX_ID=${SANDBOX_ID} \
    ${IMAGE})

echo "Container started: ${CONTAINER_ID}"

# Wait for SSH to be ready
echo "[2/4] Waiting for SSH to be ready..."
for i in {1..30}; do
    if docker exec ${SANDBOX_ID} sh -c "which sshd" >/dev/null 2>&1; then
        echo "SSH daemon found"
        break
    fi
    sleep 1
done

# Additional wait for SSH to be fully ready
sleep 2

# Check container status
echo "[3/4] Checking container status..."
STATUS=$(docker inspect -f '{{.State.Status}}' ${CONTAINER_ID})
echo "Container status: ${STATUS}"

if [ "$STATUS" != "running" ]; then
    echo "ERROR: Container is not running!"
    docker logs ${CONTAINER_ID} 2>&1 | tail -30
    exit 1
fi

# Try SSH connection
echo "[4/4] Testing SSH connection..."
SSH_OUTPUT=$(sshpass -p ${TOKEN} ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 root@127.0.0.1 "echo 'SSH connection successful'" 2>&1 || echo "SSH_FAILED")

if echo "$SSH_OUTPUT" | grep -q "SSH connection successful"; then
    echo "=== TEST PASSED ==="
    echo "Successfully connected via SSH and executed command"
    exit 0
else
    echo "=== TEST FAILED ==="
    echo "SSH output: $SSH_OUTPUT"
    echo ""
    echo "Container logs:"
    docker logs ${CONTAINER_ID} 2>&1 | tail -30
    exit 1
fi
```

**Step 2: Make executable**

```bash
chmod +x docker/test-sandbox-ssh.sh
```

**Step 3: Test the script**

```bash
# Build agent image first
cd apps/agent && docker build -t codepod/agent:latest . -f Dockerfile

# Run the test
./docker/test-sandbox-ssh.sh
```

**Step 4: Commit**

```bash
git add docker/test-sandbox-ssh.sh
git commit -m "test: add shell script for sandbox SSH E2E test"
```

---

## Execution Handoff

**Plan complete and saved to `docs/plans/2026-02-18-sandbox-ssh-e2e.md`. Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
