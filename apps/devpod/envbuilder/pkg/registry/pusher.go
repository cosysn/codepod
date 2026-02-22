package registry

import (
	"fmt"
	"os"
	"os/exec"
)

type Pusher struct {
	registry string
}

func NewPusher(registry string) *Pusher {
	return &Pusher{
		registry: registry,
	}
}

func (p *Pusher) PushImage(imageName string) error {
	// Tag image with registry prefix
	taggedName := fmt.Sprintf("%s/%s", p.registry, imageName)

	// Tag the image
	tagCmd := exec.Command("docker", "tag", imageName, taggedName)
	if output, err := tagCmd.CombinedOutput(); err != nil {
		return fmt.Errorf("failed to tag image: %w - output: %s", err, string(output))
	}

	// Push the image
	pushCmd := exec.Command("docker", "push", taggedName)
	pushCmd.Stdout = os.Stdout
	pushCmd.Stderr = os.Stderr

	if output, err := pushCmd.CombinedOutput(); err != nil {
		return fmt.Errorf("failed to push image: %w - output: %s", err, string(output))
	}

	return nil
}
