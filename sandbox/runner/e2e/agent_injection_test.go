package e2e

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/codepod/codepod/sandbox/runner/pkg/docker"
	"github.com/codepod/codepod/sandbox/runner/pkg/sandbox"
)

const (
	testImage     = "alpine:3.19"
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

	agentPath := os.Getenv("AGENT_BINARY_PATH")
	if agentPath == "" {
		t.Fatal("AGENT_BINARY_PATH not set")
	}

	dockerHost := os.Getenv("CODEPOD_DOCKER_HOST")
	if dockerHost == "" {
		dockerHost = "unix:///var/run/docker.sock"
	}

	dockerClient, err := docker.NewClient(dockerHost)
	if err != nil {
		t.Fatalf("Failed to create Docker client: %v", err)
	}

	networkID, err := dockerClient.CreateNetwork(ctx, testNetwork)
	if err != nil {
		t.Logf("Network might already exist: %v", err)
	}

	defer func() {
		if networkID != "" {
			dockerClient.RemoveNetwork(ctx, networkID)
		}
	}()

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

	defer func() {
		dockerClient.StopContainer(ctx, sb.ContainerID, 10)
		dockerClient.RemoveContainer(ctx, sb.ContainerID, true)
	}()

	if err := manager.Start(ctx, sb); err != nil {
		t.Fatalf("Failed to start sandbox: %v", err)
	}

	time.Sleep(2 * time.Second)

	status, err := dockerClient.ContainerStatus(ctx, sb.ContainerID)
	if err != nil {
		t.Fatalf("Failed to get container status: %v", err)
	}
	if status != "running" {
		logs, _ := dockerClient.ContainerLogs(ctx, sb.ContainerID, false)
		t.Logf("Container logs: %s", logs)
		t.Fatalf("Container not running, status: %s", status)
	}

	t.Logf("Agent injected successfully, container running: %s", sb.ContainerID)
}
