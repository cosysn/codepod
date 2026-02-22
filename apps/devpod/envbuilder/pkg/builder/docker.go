package builder

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
)

// DockerBuilder builds images using Docker (when Docker daemon is available)
type DockerBuilder struct {
	context    string
	image      string
	dockerfile string
}

func NewDockerBuilder(context, image string) *DockerBuilder {
	return &DockerBuilder{
		context: context,
		image:   image,
	}
}

func (b *DockerBuilder) SetDockerfile(dockerfile string) *DockerBuilder {
	b.dockerfile = dockerfile
	return b
}

func (b *DockerBuilder) Build(ctx context.Context) error {
	log.Println("Using Docker to build image...")

	// Determine Dockerfile path
	dockerfilePath := b.dockerfile
	if dockerfilePath == "" {
		dockerfilePath = b.context + "/Dockerfile"
	}

	// Check if Docker daemon is available
	cmd := exec.Command("docker", "info")
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("Docker daemon is not available. Cannot use Docker builder")
	}

	// Build the image
	buildCmd := exec.Command("docker", "build",
		"-t", b.image,
		"-f", dockerfilePath,
		b.context,
	)
	buildCmd.Stdout = os.Stdout
	buildCmd.Stderr = os.Stderr
	buildCmd.Dir = b.context

	log.Printf("Building image: %s", b.image)
	if err := buildCmd.Run(); err != nil {
		return fmt.Errorf("docker build failed: %w", err)
	}

	// Push the image
	log.Printf("Pushing image to registry...")
	pushCmd := exec.Command("docker", "push", b.image)
	pushCmd.Stdout = os.Stdout
	pushCmd.Stderr = os.Stderr

	if err := pushCmd.Run(); err != nil {
		return fmt.Errorf("docker push failed: %w", err)
	}

	log.Println("Build and push completed successfully!")
	return nil
}

// UseDocker checks if Docker is available and daemon is running
func UseDocker() bool {
	cmd := exec.Command("docker", "info")
	return cmd.Run() == nil
}

// HasDockerSocket checks if Docker socket is available
func HasDockerSocket() bool {
	_, err := os.Stat("/var/run/docker.sock")
	return err == nil
}
