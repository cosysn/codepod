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

	// Create sandbox - note: Env is map[string]string
	manager := sandbox.NewManager(dockerClient)
	opts := &sandbox.CreateOptions{
		Name:  testSandboxID,
		Image: testImage,
		Env: map[string]string{
			"AGENT_TOKEN":     testToken,
			"AGENT_SANDBOX_ID": testSandboxID,
		},
		Memory: "512MB",
		CPU:    1,
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

	// For direct container access, use host network mode (to be implemented in Task 3)
	// For now, we connect via bridge network - this test will fail until Task 3
	host := "localhost"
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
