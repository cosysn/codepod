package hooks

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type Executor struct {
	hooksDir string
}

func NewExecutor(hooksDir string) *Executor {
	return &Executor{
		hooksDir: hooksDir,
	}
}

func (e *Executor) ExecuteHook(name string, commands []string) error {
	if len(commands) == 0 {
		return nil
	}

	// Create hook script
	hookPath := filepath.Join(e.hooksDir, name)
	script := "#!/bin/bash\n" + strings.Join(commands, "\n")

	if err := os.WriteFile(hookPath, []byte(script), 0755); err != nil {
		return fmt.Errorf("failed to write hook: %w", err)
	}

	// Execute hook
	cmd := exec.Command("/bin/bash", hookPath)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

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
