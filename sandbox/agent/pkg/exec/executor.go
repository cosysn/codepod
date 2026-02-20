package exec

import (
	"bytes"
	"context"
	"os/exec"
	"time"
)

type Executor struct{}

type ExecRequest struct {
	Command   string
	Env       map[string]string
	Timeout   time.Duration
	TTY       bool
}

type ExecResult struct {
	ExitCode  int
	Stdout    string
	Stderr    string
	Duration  time.Duration
}

func (e *Executor) Execute(ctx context.Context, req *ExecRequest) *ExecResult {
	start := time.Now()

	var cmd *exec.Cmd
	if req.TTY {
		cmd = exec.Command("/bin/sh", "-c", req.Command)
	} else {
		cmd = exec.Command("/bin/sh", "-c", req.Command)
	}

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		if exitError, ok := err.(*exec.ExitError); ok {
			return &ExecResult{
				ExitCode: exitError.ExitCode(),
				Stdout:   stdout.String(),
				Stderr:   stderr.String(),
				Duration: time.Since(start),
			}
		}
	}

	return &ExecResult{
		ExitCode: 0,
		Stdout:   stdout.String(),
		Stderr:   stderr.String(),
		Duration: time.Since(start),
	}
}
