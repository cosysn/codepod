package process

import (
	"context"
	"sync"
	"testing"
	"time"
)

func TestNewManager(t *testing.T) {
	mgr := NewManager()
	if mgr == nil {
		t.Fatal("expected manager, got nil")
	}
	if mgr.Count() != 0 {
		t.Errorf("expected 0 processes, got %d", mgr.Count())
	}
}

func TestProcessStatusConstants(t *testing.T) {
	statuses := []ProcessStatus{
		ProcessStatusRunning,
		ProcessStatusFinished,
		ProcessStatusFailed,
		ProcessStatusKilled,
	}

	expected := []string{"running", "finished", "failed", "killed"}

	for i, s := range statuses {
		if string(s) != expected[i] {
			t.Errorf("expected %s, got %s", expected[i], s)
		}
	}
}

func TestStartProcess(t *testing.T) {
	mgr := NewManager()
	ctx := context.Background()

	// Start a quick exit process
	proc, err := mgr.Start(ctx, "true", []string{}, &StartOptions{})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if proc == nil {
		t.Fatal("expected process, got nil")
	}

	if proc.ID == "" {
		t.Error("expected process ID, got empty string")
	}
	if proc.Cmd != "true" {
		t.Errorf("expected cmd true, got %s", proc.Cmd)
	}
	if proc.Status != ProcessStatusRunning {
		t.Errorf("expected status running, got %s", proc.Status)
	}
	if proc.PID == 0 {
		t.Error("expected PID > 0")
	}
}

func TestGetProcess(t *testing.T) {
	mgr := NewManager()
	ctx := context.Background()

	proc1, _ := mgr.Start(ctx, "true", []string{}, &StartOptions{})

	proc2 := mgr.Get(proc1.ID)
	if proc2 == nil {
		t.Fatal("expected process, got nil")
	}
	if proc2.ID != proc1.ID {
		t.Errorf("expected ID %s, got %s", proc1.ID, proc2.ID)
	}

	// Get non-existent process
	proc3 := mgr.Get("non-existent")
	if proc3 != nil {
		t.Error("expected nil for non-existent process")
	}
}

func TestListProcesses(t *testing.T) {
	mgr := NewManager()
	ctx := context.Background()

	mgr.Start(ctx, "true", []string{}, &StartOptions{})
	mgr.Start(ctx, "true", []string{}, &StartOptions{})
	mgr.Start(ctx, "true", []string{}, &StartOptions{})

	procs := mgr.List()
	if len(procs) != 3 {
		t.Errorf("expected 3 processes, got %d", len(procs))
	}
}

func TestKillProcess(t *testing.T) {
	mgr := NewManager()
	ctx := context.Background()

	// Start a long-running process
	proc, err := mgr.Start(ctx, "sleep", []string{"100"}, &StartOptions{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	err = mgr.Kill(proc.ID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Check process status
	proc2 := mgr.Get(proc.ID)
	if proc2.Status != ProcessStatusKilled {
		t.Errorf("expected status killed, got %s", proc2.Status)
	}
	if proc2.ExitCode != 137 {
		t.Errorf("expected exit code 137, got %d", proc2.ExitCode)
	}
}

func TestKillNonExistent(t *testing.T) {
	mgr := NewManager()

	err := mgr.Kill("non-existent")
	if err == nil {
		t.Error("expected error for non-existent process")
	}
}

func TestWaitProcess(t *testing.T) {
	mgr := NewManager()
	ctx := context.Background()

	// Start a quick process
	proc, err := mgr.Start(ctx, "true", []string{}, &StartOptions{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Wait for it
	result, err := mgr.Wait(proc.ID, 5*time.Second)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.Status != ProcessStatusFinished {
		t.Errorf("expected status finished, got %s", result.Status)
	}
}

func TestWaitTimeout(t *testing.T) {
	mgr := NewManager()
	ctx := context.Background()

	// Start a long-running process
	proc, err := mgr.Start(ctx, "sleep", []string{"100"}, &StartOptions{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Wait with short timeout
	_, err = mgr.Wait(proc.ID, 100*time.Millisecond)
	if err == nil {
		t.Error("expected timeout error")
	}

	// Cleanup
	mgr.Kill(proc.ID)
}

func TestCleanup(t *testing.T) {
	mgr := NewManager()
	ctx := context.Background()

	// Start and finish a process
	proc, _ := mgr.Start(ctx, "true", []string{}, &StartOptions{})
	mgr.Wait(proc.ID, 5*time.Second)

	// Wait a bit then cleanup
	time.Sleep(100 * time.Millisecond)
	mgr.Cleanup(50 * time.Millisecond)

	// Process should be removed
	p := mgr.Get(proc.ID)
	if p != nil {
		t.Error("expected process to be cleaned up")
	}
}

func TestCountRunning(t *testing.T) {
	mgr := NewManager()
	ctx := context.Background()

	if mgr.Count() != 0 {
		t.Errorf("expected 0, got %d", mgr.Count())
	}

	// Start some processes
	mgr.Start(ctx, "sleep", []string{"100"}, &StartOptions{})
	mgr.Start(ctx, "sleep", []string{"100"}, &StartOptions{})
	mgr.Start(ctx, "true", []string{}, &StartOptions{})

	// Wait for true
	time.Sleep(100 * time.Millisecond)

	count := mgr.Count()
	if count != 2 {
		t.Errorf("expected 2 running processes, got %d", count)
	}

	// Cleanup
	for _, p := range mgr.List() {
		if p.Status == ProcessStatusRunning {
			mgr.Kill(p.ID)
		}
	}
}

func TestStartOptions(t *testing.T) {
	opts := &StartOptions{
		Env:     []string{"A=1", "B=2"},
		Dir:     "/tmp",
		Timeout: 10 * time.Second,
	}

	if len(opts.Env) != 2 {
		t.Errorf("expected 2 env vars, got %d", len(opts.Env))
	}
	if opts.Dir != "/tmp" {
		t.Errorf("expected dir /tmp, got %s", opts.Dir)
	}
	if opts.Timeout != 10*time.Second {
		t.Errorf("expected timeout 10s, got %v", opts.Timeout)
	}
}

func TestConfig(t *testing.T) {
	cfg := &Config{
		MaxProcs:   10,
		MaxMemory:  512 * 1024 * 1024,
		MaxCPU:     50,
		Timeout:    1 * time.Hour,
		WorkingDir: "/workspace",
	}

	if cfg.MaxProcs != 10 {
		t.Errorf("expected max procs 10, got %d", cfg.MaxProcs)
	}
	if cfg.MaxMemory != 512*1024*1024 {
		t.Errorf("expected max memory 512MB, got %d", cfg.MaxMemory)
	}
}

func TestConcurrentStart(t *testing.T) {
	mgr := NewManager()
	ctx := context.Background()
	var wg sync.WaitGroup

	// Start processes concurrently with long enough sleep
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			_, err := mgr.Start(ctx, "sleep", []string{"10"}, &StartOptions{})
			if err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		}(i)
	}

	// Wait for all to start
	wg.Wait()

	// Check count
	count := mgr.Count()
	if count != 10 {
		t.Errorf("expected 10 processes, got %d", count)
	}

	// Cleanup
	for _, p := range mgr.List() {
		mgr.Kill(p.ID)
	}
}

func TestProcessWithDir(t *testing.T) {
	mgr := NewManager()
	ctx := context.Background()

	// Start process with working directory
	proc, err := mgr.Start(ctx, "pwd", []string{}, &StartOptions{
		Dir: "/tmp",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	mgr.Wait(proc.ID, 5*time.Second)
}
