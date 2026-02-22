package hooks

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type Executor struct {
	hooksDir string
	stdout  *os.File
	stderr  *os.File
}

// Option is a function that configures an Executor
type Option func(*Executor)

// WithStdout sets the stdout for hook execution
func WithStdout(w *os.File) Option {
	return func(e *Executor) {
		e.stdout = w
	}
}

// WithStderr sets the stderr for hook execution
func WithStderr(w *os.File) Option {
	return func(e *Executor) {
		e.stderr = w
	}
}

func NewExecutor(hooksDir string, opts ...Option) *Executor {
	e := &Executor{
		hooksDir: hooksDir,
		stdout:   os.Stdout,
		stderr:   os.Stderr,
	}
	for _, opt := range opts {
		opt(e)
	}
	return e
}

func (e *Executor) ExecuteHook(name string, commands []string) error {
	return e.ExecuteHookWithContext(context.Background(), name, commands)
}

func (e *Executor) ExecuteHookWithContext(ctx context.Context, name string, commands []string) error {
	if len(commands) == 0 {
		return nil
	}

	// Ensure hooks directory exists
	if err := os.MkdirAll(e.hooksDir, 0755); err != nil {
		return fmt.Errorf("failed to create hooks directory: %w", err)
	}

	// Create hook script
	hookPath := filepath.Join(e.hooksDir, name)
	script := "#!/bin/bash\n" + strings.Join(commands, "\n")

	if err := os.WriteFile(hookPath, []byte(script), 0755); err != nil {
		return fmt.Errorf("failed to write hook: %w", err)
	}

	// Create context with timeout
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	// Execute hook with context
	cmd := exec.CommandContext(ctx, "/bin/bash", hookPath)
	cmd.Stdout = e.stdout
	cmd.Stderr = e.stderr

	return cmd.Run()
}

func (e *Executor) WriteHookToImage(name string, commands []string, dockerfilePath string) error {
	if len(commands) == 0 {
		return nil
	}

	// Generate RUN instruction for hook
	script := strings.Join(commands, " && ")
	runInstruction := fmt.Sprintf("RUN %s\n", script)

	// Append to Dockerfile
	f, err := os.OpenFile(dockerfilePath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	defer f.Close()

	_, err = f.WriteString(runInstruction)
	return err
}
