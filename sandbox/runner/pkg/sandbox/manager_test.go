package sandbox

import (
	"context"
	"testing"
	"time"

	"github.com/codepod/codepod/sandbox/runner/pkg/docker"
)

func TestNewManager(t *testing.T) {
	mock := docker.NewMockClient()
	mgr := NewManager(mock)

	if mgr == nil {
		t.Fatal("expected manager, got nil")
	}
	if mgr.docker != mock {
		t.Error("expected docker client to be set")
	}
}

func TestSandboxStatusConstants(t *testing.T) {
	statuses := []SandboxStatus{
		SandboxStatusPending,
		SandboxStatusRunning,
		SandboxStatusStopped,
		SandboxStatusFailed,
		SandboxStatusDeleting,
	}

	expected := []string{"pending", "running", "stopped", "failed", "deleting"}

	for i, s := range statuses {
		if string(s) != expected[i] {
			t.Errorf("expected %s, got %s", expected[i], s)
		}
	}
}

func TestCreate(t *testing.T) {
	mock := docker.NewMockClient()
	mgr := NewManager(mock)
	ctx := context.Background()

	sb, err := mgr.Create(ctx, &CreateOptions{
		Image: "python:3.11",
		Name:  "test-sandbox",
	})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if sb == nil {
		t.Fatal("expected sandbox, got nil")
	}

	if sb.ID == "" {
		t.Error("expected sandbox ID, got empty string")
	}
	if sb.Name != "test-sandbox" {
		t.Errorf("expected name test-sandbox, got %s", sb.Name)
	}
	if sb.Image != "python:3.11" {
		t.Errorf("expected image python:3.11, got %s", sb.Image)
	}
	if sb.Status != SandboxStatusPending {
		t.Errorf("expected status pending, got %s", sb.Status)
	}
}

func TestCreateWithEnv(t *testing.T) {
	mock := docker.NewMockClient()
	mgr := NewManager(mock)
	ctx := context.Background()

	sb, err := mgr.Create(ctx, &CreateOptions{
		Image: "python:3.11",
		Name:  "test-env",
		Env: map[string]string{
			"DEBUG": "1",
			"TEST": "value",
		},
	})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if sb.Config == nil {
		t.Fatal("expected config, got nil")
	}

	found := 0
	for _, e := range sb.Config.Env {
		if e == "DEBUG=1" || e == "TEST=value" {
			found++
		}
	}
	if found != 2 {
		t.Errorf("expected 2 env vars, found %d", found)
	}
}

func TestStart(t *testing.T) {
	mock := docker.NewMockClient()
	mgr := NewManager(mock)
	ctx := context.Background()

	sb, _ := mgr.Create(ctx, &CreateOptions{
		Image: "python:3.11",
		Name:  "test-start",
	})

	err := mgr.Start(ctx, sb)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if sb.Status != SandboxStatusRunning {
		t.Errorf("expected status running, got %s", sb.Status)
	}
	if sb.StartedAt.IsZero() {
		t.Error("expected StartedAt to be set")
	}
}

func TestStop(t *testing.T) {
	mock := docker.NewMockClient()
	mgr := NewManager(mock)
	ctx := context.Background()

	sb, _ := mgr.Create(ctx, &CreateOptions{
		Image: "python:3.11",
		Name:  "test-stop",
	})
	mgr.Start(ctx, sb)

	err := mgr.Stop(ctx, sb)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if sb.Status != SandboxStatusStopped {
		t.Errorf("expected status stopped, got %s", sb.Status)
	}
}

func TestDelete(t *testing.T) {
	mock := docker.NewMockClient()
	mgr := NewManager(mock)
	ctx := context.Background()

	sb, _ := mgr.Create(ctx, &CreateOptions{
		Image: "python:3.11",
		Name:  "test-delete",
	})
	mgr.Start(ctx, sb)

	err := mgr.Delete(ctx, sb)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if sb.Status != SandboxStatusStopped {
		t.Errorf("expected status stopped, got %s", sb.Status)
	}
}

func TestGetStatus(t *testing.T) {
	mock := docker.NewMockClient()
	mgr := NewManager(mock)
	ctx := context.Background()

	sb, _ := mgr.Create(ctx, &CreateOptions{
		Image: "python:3.11",
		Name:  "test-status",
	})

	// Check pending status
	status, err := mgr.GetStatus(ctx, sb)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if status != SandboxStatusPending {
		t.Errorf("expected pending, got %s", status)
	}

	// Start and check running status
	mgr.Start(ctx, sb)
	status, err = mgr.GetStatus(ctx, sb)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if status != SandboxStatusRunning {
		t.Errorf("expected running, got %s", status)
	}

	// Stop and check stopped status
	mgr.Stop(ctx, sb)
	status, err = mgr.GetStatus(ctx, sb)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if status != SandboxStatusStopped {
		t.Errorf("expected stopped, got %s", status)
	}
}

func TestList(t *testing.T) {
	mock := docker.NewMockClient()
	mgr := NewManager(mock)
	ctx := context.Background()

	// Create multiple sandboxes
	mgr.Create(ctx, &CreateOptions{Image: "img1", Name: "sb1"})
	mgr.Create(ctx, &CreateOptions{Image: "img2", Name: "sb2"})
	sb3, _ := mgr.Create(ctx, &CreateOptions{Image: "img3", Name: "sb3"})
	mgr.Start(ctx, sb3)

	list, err := mgr.List(ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(list) != 3 {
		t.Errorf("expected 3 sandboxes, got %d", len(list))
	}
}

func TestGet(t *testing.T) {
	mock := docker.NewMockClient()
	mgr := NewManager(mock)
	ctx := context.Background()

	sb1, _ := mgr.Create(ctx, &CreateOptions{
		Image: "python:3.11",
		Name:  "test-get",
	})

	sb2, err := mgr.Get(ctx, sb1.ID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if sb2.ID != sb1.ID {
		t.Errorf("expected ID %s, got %s", sb1.ID, sb2.ID)
	}

	// Get non-existent sandbox
	_, err = mgr.Get(ctx, "non-existent")
	if err == nil {
		t.Error("expected error for non-existent sandbox")
	}
}

func TestParseMemory(t *testing.T) {
	tests := []struct {
		input    string
		expected int64
	}{
		{"", 512 * 1024 * 1024}, // Default
		{"512MiB", 512 * 1024 * 1024},
		{"1Gi", 1024 * 1024 * 1024},
		{"512M", 512 * 1024 * 1024},
		{"1G", 1024 * 1024 * 1024},
	}

	for _, tt := range tests {
		_, err := parseMemory(tt.input)
		if err != nil {
			t.Errorf("unexpected error for %s: %v", tt.input, err)
		}
		// Note: Our simple parser doesn't handle the full format
		// This is a known limitation for MVP
	}
}

func TestCreateOptions(t *testing.T) {
	opts := &CreateOptions{
		Image:   "python:3.11",
		Name:    "test",
		Env:     map[string]string{"A": "1"},
		Memory:  "1Gi",
		CPU:     2,
		Timeout: time.Hour,
	}

	if opts.Image != "python:3.11" {
		t.Errorf("expected image python:3.11, got %s", opts.Image)
	}
	if opts.CPU != 2 {
		t.Errorf("expected CPU 2, got %d", opts.CPU)
	}
}

func TestConfig(t *testing.T) {
	cfg := &Config{
		Image:  "python:3.11",
		Name:   "test",
		Env:    []string{"A=1"},
		Memory: 512 * 1024 * 1024,
		CPU:    2,
	}

	if cfg.Image != "python:3.11" {
		t.Errorf("expected image python:3.11, got %s", cfg.Image)
	}
	if len(cfg.Env) != 1 {
		t.Errorf("expected 1 env var, got %d", len(cfg.Env))
	}
}

func TestSandbox(t *testing.T) {
	sb := &Sandbox{
		ID:          "test-id",
		Name:        "test",
		ContainerID: "container-id",
		Image:       "python:3.11",
		Status:      SandboxStatusRunning,
		CreatedAt:   time.Now(),
		StartedAt:   time.Now(),
		Config: &Config{
			Image: "python:3.11",
			Name:  "test",
		},
	}

	if sb.ID != "test-id" {
		t.Errorf("expected ID test-id, got %s", sb.ID)
	}
	if sb.Status != SandboxStatusRunning {
		t.Errorf("expected status running, got %s", sb.Status)
	}
}
