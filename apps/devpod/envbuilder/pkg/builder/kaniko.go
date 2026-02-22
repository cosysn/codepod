package builder

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
)

// Builder defines the interface for container image builders
type Builder interface {
	SetDockerfile(dockerfile string) Builder
	Build(ctx context.Context) error
}

type KanikoBuilder struct {
	context    string
	image      string
	dockerfile string
	kanikoPath string
	stdout     io.Writer
	stderr     io.Writer
}

func NewKanikoBuilder(context, image string) *KanikoBuilder {
	return &KanikoBuilder{
		context:    context,
		image:      image,
		kanikoPath: "/kaniko/executor",
		stdout:     os.Stdout,
		stderr:     os.Stderr,
	}
}

func (b *KanikoBuilder) SetDockerfile(dockerfile string) Builder {
	b.dockerfile = dockerfile
	return b
}

func (b *KanikoBuilder) SetKanikoPath(path string) Builder {
	b.kanikoPath = path
	return b
}

func (b *KanikoBuilder) SetStdout(w io.Writer) Builder {
	b.stdout = w
	return b
}

func (b *KanikoBuilder) SetStderr(w io.Writer) Builder {
	b.stderr = w
	return b
}

func (b *KanikoBuilder) Build(ctx context.Context) error {
	// Check if kaniko binary exists
	if _, err := os.Stat(b.kanikoPath); os.IsNotExist(err) {
		return fmt.Errorf("kaniko binary not found at %s", b.kanikoPath)
	}

	// Build kaniko command
	cmd := exec.CommandContext(ctx, b.kanikoPath,
		"-c", b.context,
		"-d", b.image,
	)

	if b.dockerfile != "" {
		cmd.Args = append(cmd.Args, "-f", b.dockerfile)
	}

	cmd.Stdout = b.stdout
	cmd.Stderr = b.stderr

	return cmd.Run()
}
