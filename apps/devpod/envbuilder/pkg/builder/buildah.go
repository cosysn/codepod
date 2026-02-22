package builder

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"strings"
)

// BuildahBuilder builds images using buildah (daemonless container builder)
type BuildahBuilder struct {
	context    string
	image      string
	dockerfile string
	baseImage  string
	stdout     *os.File
	stderr     *os.File
}

func NewBuildahBuilder(context, image string) *BuildahBuilder {
	return &BuildahBuilder{
		context: context,
		image:   image,
		stdout:  os.Stdout,
		stderr:  os.Stderr,
	}
}

func (b *BuildahBuilder) SetDockerfile(dockerfile string) *BuildahBuilder {
	b.dockerfile = dockerfile
	return b
}

func (b *BuildahBuilder) SetBaseImage(baseImage string) *BuildahBuilder {
	b.baseImage = baseImage
	return b
}

func (b *BuildahBuilder) SetStdout(w *os.File) *BuildahBuilder {
	b.stdout = w
	return b
}

func (b *BuildahBuilder) SetStderr(w *os.File) *BuildahBuilder {
	b.stderr = w
	return b
}

func (b *BuildahBuilder) Build(ctx context.Context) error {
	log.Println("Using buildah to build image...")

	// Determine the base image to use
	baseImage := b.baseImage
	if baseImage == "" {
		// Extract from Dockerfile
		baseImage = b.extractBaseImage()
	}

	if baseImage == "" {
		return fmt.Errorf("no base image specified")
	}

	log.Printf("Building from base image: %s", baseImage)

	// Create a buildah container from the base image
	containerName := "envbuilder-build-" + strings.ReplaceAll(b.image, "/", "-")
	defer b.cleanupContainer(containerName)

	// Pull the base image first (with mirror support)
	if err := b.pullImage(baseImage); err != nil {
		return fmt.Errorf("failed to pull base image: %w", err)
	}

	// Create container from base image
	cmd := exec.Command("buildah", "from", "--name", containerName, baseImage)
	cmd.Stdout = b.stdout
	cmd.Stderr = b.stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to create buildah container: %w", err)
	}

	// Copy build context to container
	log.Println("Copying build context...")
	cmd = exec.Command("buildah", "copy", containerName, b.context, "/")
	cmd.Stdout = b.stdout
	cmd.Stderr = b.stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to copy context: %w", err)
	}

	// Run the Dockerfile commands
	log.Println("Running build instructions...")
	if err := b.runBuildahBuild(containerName); err != nil {
		return fmt.Errorf("failed to run build: %w", err)
	}

	// Commit the container to an image
	log.Printf("Committing image as: %s", b.image)
	cmd = exec.Command("buildah", "commit", "--rm", containerName, b.image)
	cmd.Stdout = b.stdout
	cmd.Stderr = b.stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to commit image: %w", err)
	}

	log.Println("Build completed successfully!")
	return nil
}

func (b *BuildahBuilder) extractBaseImage() string {
	dockerfilePath := b.dockerfile
	if dockerfilePath == "" {
		dockerfilePath = b.context + "/Dockerfile"
	}

	content, err := os.ReadFile(dockerfilePath)
	if err != nil {
		return ""
	}

	// Parse FROM instruction
	lines := strings.Split(string(content), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "FROM ") {
			parts := strings.Fields(line)
			if len(parts) >= 2 {
				return parts[1]
			}
		}
	}
	return ""
}

func (b *BuildahBuilder) pullImage(image string) error {
	log.Printf("Pulling image: %s", image)

	// Try pulling with buildah
	cmd := exec.Command("buildah", "pull", image)
	cmd.Stdout = b.stdout
	cmd.Stderr = b.stderr

	if err := cmd.Run(); err != nil {
		// Try with skopeo
		log.Printf("buildah pull failed, trying skopeo...")
		cmd = exec.Command("skopeo", "copy", "docker://"+image, "containers-storage:"+image)
		cmd.Stdout = b.stdout
		cmd.Stderr = b.stderr
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("failed to pull image: %w", err)
		}
	}
	return nil
}

func (b *BuildahBuilder) runBuildahBuild(containerName string) error {
	dockerfilePath := b.dockerfile
	if dockerfilePath == "" {
		dockerfilePath = b.context + "/Dockerfile"
	}

	// Read Dockerfile to extract RUN commands
	content, err := os.ReadFile(dockerfilePath)
	if err != nil {
		return fmt.Errorf("failed to read Dockerfile: %w", err)
	}

	lines := strings.Split(string(content), "\n")
	for lineNum, line := range lines {
		line = strings.TrimSpace(line)

		// Skip comments and empty lines
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		// Handle RUN commands
		if strings.HasPrefix(line, "RUN ") {
			// Get the command after RUN
			cmd := strings.TrimPrefix(line, "RUN ")
			log.Printf("Executing: %s", cmd)

			execCmd := exec.Command("buildah", "run", containerName, "sh", "-c", cmd)
			execCmd.Stdout = b.stdout
			execCmd.Stderr = b.stderr

			if err := execCmd.Run(); err != nil {
				return fmt.Errorf("failed at line %d: %w", lineNum+1, err)
			}
		}

		// Handle other commands we might need to support
		// COPY, ADD, ENV, WORKDIR, etc.
		if strings.HasPrefix(line, "COPY ") || strings.HasPrefix(line, "ADD ") {
			// Already handled by buildah copy above
		}
	}

	return nil
}

func (b *BuildahBuilder) cleanupContainer(name string) {
	cmd := exec.Command("buildah", "rm", name)
	cmd.Run()
}

// UseBuildah sets the builder to use buildah instead of kaniko
func UseBuildah() bool {
	// Check if buildah is available
	_, err := exec.LookPath("buildah")
	return err == nil
}
