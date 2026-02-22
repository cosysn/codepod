package builder

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
)

// ConfigureRegistryMirror configures Docker to use a registry mirror and pre-pull base images
func ConfigureRegistryMirror(mirrorURL string) error {
	// Create Docker config directory
	dockerConfigDir := "/root/.docker"
	if err := os.MkdirAll(dockerConfigDir, 0755); err != nil {
		return fmt.Errorf("failed to create docker config directory: %w", err)
	}

	// Create daemon.json with registry mirrors
	daemonConfig := fmt.Sprintf(`{
	"registry-mirrors": ["%s"]
}`, mirrorURL)

	daemonConfigPath := dockerConfigDir + "/daemon.json"
	if err := os.WriteFile(daemonConfigPath, []byte(daemonConfig), 0644); err != nil {
		return fmt.Errorf("failed to write daemon.json: %w", err)
	}

	// Restart Docker daemon to apply changes (if running)
	exec.Command("pkill", "-SIGHUP", "dockerd").Run()

	return nil
}

// PrePullBaseImage pre-pulls a base image using Docker with the configured mirror
func PrePullBaseImage(imageName, mirrorURL string) error {
	// If mirror URL is provided, try to pull from the mirror
	if mirrorURL != "" {
		// Construct mirror image URL
		mirrorImage := convertToMirrorImage(imageName, mirrorURL)

		// Try to pull from mirror
		cmd := exec.Command("docker", "pull", mirrorImage)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if err := cmd.Run(); err == nil {
			// Tag back to original name
			tagCmd := exec.Command("docker", "tag", mirrorImage, imageName)
			return tagCmd.Run()
		}
		// If mirror pull fails, continue with original image
	}

	// Pull from original registry
	cmd := exec.Command("docker", "pull", imageName)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

// convertToMirrorImage converts an image name to use a mirror registry
func convertToMirrorImage(imageName, mirrorURL string) string {
	// Remove protocol from mirror URL
	mirrorURL = strings.TrimPrefix(mirrorURL, "https://")
	mirrorURL = strings.TrimPrefix(mirrorURL, "http://")

	// Extract original registry and image name
	parts := strings.SplitN(imageName, "/", 2)
	if len(parts) == 2 && strings.Contains(parts[0], ".") {
		// Has a registry prefix (e.g., docker.io/library/ubuntu)
		return mirrorURL + "/" + parts[1]
	}
	// No registry prefix (e.g., ubuntu)
	return mirrorURL + "/library/" + imageName
}

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
