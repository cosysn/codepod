package registry

import (
	"fmt"
	"os/exec"
	"strings"
)

// CommandRunner interface for running commands (allows mocking in tests)
type CommandRunner interface {
	Run(name string, args ...string) error
	Output(name string, args ...string) ([]byte, error)
}

// RealCommandRunner executes real system commands
type RealCommandRunner struct{}

func (r *RealCommandRunner) Run(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	return cmd.Run()
}

func (r *RealCommandRunner) Output(name string, args ...string) ([]byte, error) {
	cmd := exec.Command(name, args...)
	return cmd.CombinedOutput()
}

// Pusher handles pushing images to a registry
type Pusher struct {
	registry string
	cmdRunner CommandRunner
}

func NewPusher(registry string) *Pusher {
	return &Pusher{
		registry: registry,
		cmdRunner: &RealCommandRunner{},
	}
}

// NewPusherWithRunner creates a Pusher with a custom command runner (for testing)
func NewPusherWithRunner(registry string, runner CommandRunner) *Pusher {
	return &Pusher{
		registry: registry,
		cmdRunner: runner,
	}
}

func (p *Pusher) PushImage(imageName string) error {
	// Validate input
	if strings.TrimSpace(imageName) == "" {
		return fmt.Errorf("image name cannot be empty")
	}

	// Tag image with registry prefix
	taggedName := fmt.Sprintf("%s/%s", p.registry, imageName)

	// Tag the image
	output, err := p.cmdRunner.Output("docker", "tag", imageName, taggedName)
	if err != nil {
		return fmt.Errorf("failed to tag image: %w - output: %s", err, string(output))
	}

	// Push the image - stream output to stdout/stderr
	err = p.cmdRunner.Run("docker", "push", taggedName)
	if err != nil {
		return fmt.Errorf("failed to push image: %w", err)
	}

	return nil
}
