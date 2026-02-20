package docker

import (
	"context"
	"io"
	"testing"
	"time"
)

func TestMockClient_CreateContainer(t *testing.T) {
	client := NewMockClient()
	ctx := context.Background()

	config := &ContainerConfig{
		Image: "python:3.11",
		Name:  "test",
	}

	id, err := client.CreateContainer(ctx, config)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if id == "" {
		t.Error("expected container ID, got empty string")
	}

	// Check container was created
	c := client.GetContainer(id)
	if c == nil {
		t.Fatal("container not found")
	}
	if c.state != ContainerStateCreated {
		t.Errorf("expected state created, got %s", c.state)
	}
}

func TestMockClient_StartContainer(t *testing.T) {
	client := NewMockClient()
	ctx := context.Background()

	config := &ContainerConfig{
		Image: "python:3.11",
		Name:  "test",
	}

	id, _ := client.CreateContainer(ctx, config)

	err := client.StartContainer(ctx, id)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	c := client.GetContainer(id)
	if c.state != ContainerStateRunning {
		t.Errorf("expected state running, got %s", c.state)
	}
	if c.startedAt.IsZero() {
		t.Error("expected startedAt to be set")
	}
}

func TestMockClient_StartContainer_NotFound(t *testing.T) {
	client := NewMockClient()
	ctx := context.Background()

	err := client.StartContainer(ctx, "nonexistent")
	if err == nil {
		t.Error("expected error for nonexistent container")
	}
	if !IsNotFound(err) {
		t.Errorf("expected not found error, got %v", err)
	}
}

func TestMockClient_StopContainer(t *testing.T) {
	client := NewMockClient()
	ctx := context.Background()

	config := &ContainerConfig{
		Image: "python:3.11",
		Name:  "test",
	}

	id, _ := client.CreateContainer(ctx, config)
	client.StartContainer(ctx, id)

	err := client.StopContainer(ctx, id, 10)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	c := client.GetContainer(id)
	if c.state != ContainerStateExited {
		t.Errorf("expected state exited, got %s", c.state)
	}
}

func TestMockClient_RemoveContainer(t *testing.T) {
	client := NewMockClient()
	ctx := context.Background()

	config := &ContainerConfig{
		Image: "python:3.11",
		Name:  "test",
	}

	id, _ := client.CreateContainer(ctx, config)

	err := client.RemoveContainer(ctx, id, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	c := client.GetContainer(id)
	if c != nil {
		t.Error("expected container to be removed")
	}
}

func TestMockClient_RemoveContainer_Force(t *testing.T) {
	client := NewMockClient()
	ctx := context.Background()

	config := &ContainerConfig{
		Image: "python:3.11",
		Name:  "test",
	}

	id, _ := client.CreateContainer(ctx, config)
	client.StartContainer(ctx, id)

	// Should fail without force
	err := client.RemoveContainer(ctx, id, false)
	if err == nil {
		t.Error("expected error when removing running container without force")
	}

	// Should succeed with force
	err = client.RemoveContainer(ctx, id, true)
	if err != nil {
		t.Fatalf("unexpected error with force: %v", err)
	}
}

func TestMockClient_ListContainers(t *testing.T) {
	client := NewMockClient()
	ctx := context.Background()

	// Create some containers
	client.CreateContainer(ctx, &ContainerConfig{Image: "img1", Name: "c1"})
	client.CreateContainer(ctx, &ContainerConfig{Image: "img2", Name: "c2"})
	id3, _ := client.CreateContainer(ctx, &ContainerConfig{Image: "img3", Name: "c3"})
	client.StartContainer(ctx, id3)

	// List all
	all, err := client.ListContainers(ctx, true)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(all) != 3 {
		t.Errorf("expected 3 containers, got %d", len(all))
	}

	// List running only
	running, err := client.ListContainers(ctx, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(running) != 1 {
		t.Errorf("expected 1 running container, got %d", len(running))
	}
}

func TestMockClient_ContainerStatus(t *testing.T) {
	client := NewMockClient()
	ctx := context.Background()

	config := &ContainerConfig{Image: "img", Name: "test"}
	id, _ := client.CreateContainer(ctx, config)

	status, err := client.ContainerStatus(ctx, id)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if status != string(ContainerStateCreated) {
		t.Errorf("expected created, got %s", status)
	}
}

func TestMockClient_PullImage(t *testing.T) {
	client := NewMockClient()
	ctx := context.Background()

	err := client.PullImage(ctx, "python:3.11", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	exists, err := client.ImageExists(ctx, "python:3.11")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !exists {
		t.Error("expected image to exist")
	}
}

func TestMockClient_CreateNetwork(t *testing.T) {
	client := NewMockClient()
	ctx := context.Background()

	id, err := client.CreateNetwork(ctx, "test-network")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if id == "" {
		t.Error("expected network ID, got empty string")
	}
}

func TestMockClient_ContainerLogs(t *testing.T) {
	client := NewMockClient()
	ctx := context.Background()

	config := &ContainerConfig{Image: "img", Name: "test"}
	id, _ := client.CreateContainer(ctx, config)

	logs, err := client.ContainerLogs(ctx, id, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	content, err := io.ReadAll(logs)
	if err != nil {
		t.Fatalf("unexpected error reading logs: %v", err)
	}
	logs.Close()

	if len(content) == 0 {
		t.Error("expected logs content")
	}
}

func TestMockClient_SetContainerState(t *testing.T) {
	client := NewMockClient()
	ctx := context.Background()

	config := &ContainerConfig{Image: "img", Name: "test"}
	id, _ := client.CreateContainer(ctx, config)

	client.SetContainerState(id, ContainerStatePaused)

	c := client.GetContainer(id)
	if c.state != ContainerStatePaused {
		t.Errorf("expected paused state, got %s", c.state)
	}
}

func TestMockClient_ConcurrentAccess(t *testing.T) {
	client := NewMockClient()
	ctx := context.Background()
	done := make(chan bool)

	// Concurrent container operations
	for i := 0; i < 10; i++ {
		go func(idx int) {
			config := &ContainerConfig{Image: "img", Name: "test"}
			client.CreateContainer(ctx, config)
			done <- true
		}(i)
	}

	// Wait for all goroutines
	for i := 0; i < 10; i++ {
		<-done
	}

	// Check containers were created
	all, _ := client.ListContainers(ctx, true)
	if len(all) != 10 {
		t.Errorf("expected 10 containers, got %d", len(all))
	}
}

// MockReader tests
func TestMockReader_Read(t *testing.T) {
	r := &mockReader{content: []byte("hello world")}

	buf := make([]byte, 5)
	n, err := r.Read(buf)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if n != 5 {
		t.Errorf("expected 5 bytes, got %d", n)
	}
	if string(buf) != "hello" {
		t.Errorf("expected 'hello', got '%s'", string(buf))
	}
}

func TestMockReader_ReadMultiple(t *testing.T) {
	r := &mockReader{content: []byte("hello world")}

	buf := make([]byte, 5)
	n1, _ := r.Read(buf)
	n2, _ := r.Read(buf)
	n3, _ := r.Read(buf)
	_, err := r.Read(buf)
	if err != io.EOF {
		t.Errorf("expected EOF, got %v", err)
	}
	// "hello world" is 11 bytes: 5 + 5 + 1 = 11
	if n1+n2+n3 != 11 {
		t.Errorf("expected 11 total bytes, got %d", n1+n2+n3)
	}
}

func TestMockReader_Close(t *testing.T) {
	r := &mockReader{content: []byte("test")}
	if err := r.Close(); err != nil {
		t.Errorf("unexpected close error: %v", err)
	}
}

// Helper for timeout tests
func eventually(condition func() bool, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if condition() {
			return true
		}
		time.Sleep(10 * time.Millisecond)
	}
	return false
}
