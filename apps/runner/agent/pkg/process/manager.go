package process

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"time"
)

// Manager manages processes in the sandbox
type Manager struct {
	mu       sync.RWMutex
	procs    map[string]*Process
	nextID   int
}

// Process represents a running process
type Process struct {
	ID        string
	PID       int
	Cmd       string
	Args      []string
	Env       []string
	Dir       string
	ExitCode  int
	StartedAt time.Time
	FinishedAt time.Time
	Status    ProcessStatus
	Stdin     io.WriteCloser
	Stdout    io.ReadCloser
	Stderr    io.ReadCloser
}

// ProcessStatus represents process state
type ProcessStatus string

const (
	ProcessStatusRunning   ProcessStatus = "running"
	ProcessStatusFinished ProcessStatus = "finished"
	ProcessStatusFailed   ProcessStatus = "failed"
	ProcessStatusKilled   ProcessStatus = "killed"
)

// Config holds process configuration
type Config struct {
	MaxProcs    int
	MaxMemory   int64
	MaxCPU      int
	Timeout     time.Duration
	WorkingDir  string
}

// NewManager creates a new process manager
func NewManager() *Manager {
	return &Manager{
		procs:  make(map[string]*Process),
		nextID: 1,
	}
}

// Start starts a new process
func (m *Manager) Start(ctx context.Context, cmd string, args []string, opts *StartOptions) (*Process, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.nextID > 10000 {
		m.nextID = 1
	}

	id := fmt.Sprintf("proc-%d", m.nextID)
	m.nextID++

	proc := &Process{
		ID:        id,
		Cmd:       cmd,
		Args:      args,
		Env:       opts.Env,
		Dir:       opts.Dir,
		StartedAt: time.Now(),
		Status:    ProcessStatusRunning,
	}

	// Build command
	command := exec.CommandContext(ctx, cmd, args...)
	if opts.Dir != "" {
		command.Dir = opts.Dir
	}
	if len(opts.Env) > 0 {
		command.Env = append(os.Environ(), opts.Env...)
	}
	if opts.Stdin != nil {
		command.Stdin = opts.Stdin
	}

	// Capture output
	stdout, err := command.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create stdout pipe: %w", err)
	}
	stderr, err := command.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	// Set process group
	command.SysProcAttr = &syscall.SysProcAttr{
		Setsid: true,
	}

	// Start command
	if err := command.Start(); err != nil {
		return nil, fmt.Errorf("failed to start command: %w", err)
	}

	proc.PID = command.Process.Pid
	proc.Stdout = stdout
	proc.Stderr = stderr

	// Wait for process in background
	go func() {
		err := command.Wait()
		m.mu.Lock()
		defer m.mu.Unlock()

		if proc.Status != ProcessStatusKilled {
			proc.ExitCode = command.ProcessState.ExitCode()
			proc.FinishedAt = time.Now()
			if err != nil {
				proc.Status = ProcessStatusFailed
			} else {
				proc.Status = ProcessStatusFinished
			}
		}
	}()

	m.procs[id] = proc
	return proc, nil
}

// StartOptions holds options for starting a process
type StartOptions struct {
	Env     []string
	Dir     string
	Stdin   io.Reader
	Timeout time.Duration
}

// Get returns a process by ID
func (m *Manager) Get(id string) *Process {
	m.mu.RLock()
	defer m.mu.RUnlock()

	return m.procs[id]
}

// List returns all processes
func (m *Manager) List() []*Process {
	m.mu.RLock()
	defer m.mu.RUnlock()

	procs := make([]*Process, 0, len(m.procs))
	for _, p := range m.procs {
		procs = append(procs, p)
	}
	return procs
}

// Kill kills a process
func (m *Manager) Kill(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	proc, ok := m.procs[id]
	if !ok {
		return fmt.Errorf("process not found: %s", id)
	}

	if proc.Status != ProcessStatusRunning {
		return fmt.Errorf("process not running: %s", id)
	}

	if err := syscall.Kill(-proc.PID, syscall.SIGKILL); err != nil {
		return fmt.Errorf("failed to kill process: %w", err)
	}

	proc.Status = ProcessStatusKilled
	proc.ExitCode = 137
	proc.FinishedAt = time.Now()

	return nil
}

// Wait waits for a process to finish
func (m *Manager) Wait(id string, timeout time.Duration) (*Process, error) {
	proc := m.Get(id)
	if proc == nil {
		return nil, fmt.Errorf("process not found: %s", id)
	}

	// Wait with timeout
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		m.mu.RLock()
		status := proc.Status
		m.mu.RUnlock()

		if status != ProcessStatusRunning {
			return proc, nil
		}
		time.Sleep(100 * time.Millisecond)
	}

	return nil, fmt.Errorf("timeout waiting for process: %s", id)
}

// CollectOutput reads all output from stdout and stderr
func (m *Manager) CollectOutput(proc *Process) (stdout, stderr string, err error) {
	if proc.Stdout != nil {
		scanner := bufio.NewScanner(proc.Stdout)
		for scanner.Scan() {
			stdout += scanner.Text() + "\n"
		}
		proc.Stdout.Close()
	}

	if proc.Stderr != nil {
		scanner := bufio.NewScanner(proc.Stderr)
		for scanner.Scan() {
			stderr += scanner.Text() + "\n"
		}
		proc.Stderr.Close()
	}

	return stdout, stderr, nil
}

// Cleanup removes finished processes older than the given duration
func (m *Manager) Cleanup(maxAge time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()

	cutoff := time.Now().Add(-maxAge)
	for id, proc := range m.procs {
		if proc.Status != ProcessStatusRunning && proc.FinishedAt.Before(cutoff) {
			delete(m.procs, id)
		}
	}
}

// Count returns the number of running processes
func (m *Manager) Count() int {
	m.mu.RLock()
	defer m.mu.RUnlock()

	count := 0
	for _, p := range m.procs {
		if p.Status == ProcessStatusRunning {
			count++
		}
	}
	return count
}
