package builder

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
)

// Builder defines the interface for container image builders
type Builder interface {
	SetDockerfile(dockerfile string) Builder
	Build(ctx context.Context) error
}

type KanikoBuilder struct {
	context        string
	image          string
	dockerfile     string
	featureScripts map[string]string
	kanikoPath     string
	stdout         io.Writer
	stderr         io.Writer
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

func (b *KanikoBuilder) SetFeatureScripts(scripts map[string]string) Builder {
	b.featureScripts = scripts
	return b
}

func (b *KanikoBuilder) Build(ctx context.Context) error {
	// Check if kaniko binary exists
	if _, err := os.Stat(b.kanikoPath); os.IsNotExist(err) {
		return fmt.Errorf("kaniko binary not found at %s", b.kanikoPath)
	}

	// Inject feature scripts into Dockerfile if any
	if len(b.featureScripts) > 0 {
		if err := b.injectFeatureScripts(); err != nil {
			return fmt.Errorf("failed to inject feature scripts: %w", err)
		}
	}

	// Build kaniko command
	cmd := exec.CommandContext(ctx, b.kanikoPath,
		"--force", // Run outside of container
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

func (b *KanikoBuilder) injectFeatureScripts() error {
	// Determine the Dockerfile path
	dockerfilePath := b.dockerfile
	if dockerfilePath == "" {
		dockerfilePath = b.context + "/Dockerfile"
	}

	// Read existing Dockerfile
	content, err := os.ReadFile(dockerfilePath)
	if err != nil {
		return fmt.Errorf("failed to read Dockerfile: %w", err)
	}

	// Append feature script RUN commands
	var builder strings.Builder
	builder.WriteString(string(content))
	builder.WriteString("\n# Feature scripts\n")

	for feature, script := range b.featureScripts {
		// Write script to a file in the context
		scriptPath := b.context + "/.devcontainer/features/" + feature + ".sh"
		if err := os.MkdirAll(b.context+"/.devcontainer/features", 0755); err != nil {
			return fmt.Errorf("failed to create features directory: %w", err)
		}
		if err := os.WriteFile(scriptPath, []byte(script), 0755); err != nil {
			return fmt.Errorf("failed to write feature script: %w", err)
		}
		builder.WriteString(fmt.Sprintf("RUN chmod +x .devcontainer/features/%s.sh && .devcontainer/features/%s.sh\n", feature, feature))
	}

	// Write the modified Dockerfile
	if err := os.WriteFile(dockerfilePath, []byte(builder.String()), 0644); err != nil {
		return fmt.Errorf("failed to write modified Dockerfile: %w", err)
	}

	return nil
}
