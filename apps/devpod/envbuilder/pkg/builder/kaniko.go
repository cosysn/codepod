package builder

import (
	"fmt"
	"os"
	"os/exec"
)

type KanikoBuilder struct {
	context    string
	image      string
	dockerfile string
	kanikoPath string
}

func NewKanikoBuilder(context, image string) *KanikoBuilder {
	return &KanikoBuilder{
		context:    context,
		image:      image,
		kanikoPath: "/kaniko/executor",
	}
}

func (b *KanikoBuilder) SetDockerfile(dockerfile string) *KanikoBuilder {
	b.dockerfile = dockerfile
	return b
}

func (b *KanikoBuilder) Build() error {
	// Check if kaniko binary exists
	if _, err := os.Stat(b.kanikoPath); os.IsNotExist(err) {
		return fmt.Errorf("kaniko binary not found at %s", b.kanikoPath)
	}

	// Build kaniko command
	cmd := exec.Command(b.kanikoPath,
		"-c", b.context,
		"-d", b.image,
	)

	if b.dockerfile != "" {
		cmd.Args = append(cmd.Args, "-f", b.dockerfile)
	}

	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	return cmd.Run()
}
