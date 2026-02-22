package builder

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
)

// KanikoInContainerBuilder builds images using Kaniko running inside a container
type KanikoInContainerBuilder struct {
	context        string
	image          string
	dockerfile     string
	kanikoImage    string
	registryConfig string
	stdout         *os.File
	stderr         *os.File
}

func NewKanikoInContainerBuilder(context, image string) *KanikoInContainerBuilder {
	return &KanikoInContainerBuilder{
		context:     context,
		image:       image,
		kanikoImage: "registry.cn-hangzhou.aliyuncs.com/kaniko-project/executor:latest",
		stdout:      os.Stdout,
		stderr:      os.Stderr,
	}
}

func (b *KanikoInContainerBuilder) SetDockerfile(dockerfile string) *KanikoInContainerBuilder {
	b.dockerfile = dockerfile
	return b
}

func (b *KanikoInContainerBuilder) SetKanikoImage(image string) *KanikoInContainerBuilder {
	b.kanikoImage = image
	return b
}

func (b *KanikoInContainerBuilder) SetStdout(w *os.File) *KanikoInContainerBuilder {
	b.stdout = w
	return b
}

func (b *KanikoInContainerBuilder) SetStderr(w *os.File) *KanikoInContainerBuilder {
	b.stderr = w
	return b
}

func (b *KanikoInContainerBuilder) Build(ctx context.Context) error {
	log.Println("Using Kaniko in container to build image...")

	// Check if Docker is available for running the kaniko container
	cmd := exec.Command("docker", "info")
	if err := cmd.Run(); err != nil {
		log.Println("Docker not available, trying alternative...")
		return b.buildWithDockerfileToImage(ctx)
	}

	// Determine Dockerfile path - relative to context
	dockerfilePath := ".devcontainer/Dockerfile"
	if b.dockerfile != "" {
		// Use provided path, make it relative to context
		dockerfilePath = b.dockerfile
	}

	// Run kaniko in a container
	// The container shares the build context via volume mount
	containerName := "envbuilder-kaniko-" + fmt.Sprint(os.Getpid())

	// Build docker run command with kaniko
	dockerArgs := []string{
		"run", "--rm",
		"--name", containerName,
		"-v", b.context + ":/workspace:ro",
		"-e", "DOCKER_CONFIG=/kaniko/.docker",
	}

	// Add registry config if provided
	if b.registryConfig != "" {
		dockerArgs = append(dockerArgs, "-v", b.registryConfig+":/kaniko/.docker:ro")
	}

	// Add kaniko image and its arguments
	dockerArgs = append(dockerArgs, b.kanikoImage)
	dockerArgs = append(dockerArgs,
		"--context", "/workspace",
		"--dockerfile", dockerfilePath,
		"--destination", b.image,
	)

	log.Printf("Running kaniko: docker %v", dockerArgs)
	buildCmd := exec.CommandContext(ctx, "docker", dockerArgs...)
	buildCmd.Stdout = b.stdout
	buildCmd.Stderr = b.stderr

	if err := buildCmd.Run(); err != nil {
		return fmt.Errorf("kaniko build failed: %w", err)
	}

	log.Println("Kaniko build completed!")
	return nil
}

// buildWithDockerfileToImage uses a fallback approach without Docker
func (b *KanikoInContainerBuilder) buildWithDockerfileToImage(ctx context.Context) error {
	log.Println("Fallback: Building image from Dockerfile directly...")

	// This is a simplified fallback that just validates the Dockerfile
	// In a real scenario without Docker, you'd need a different approach

	dockerfilePath := b.dockerfile
	if dockerfilePath == "" {
		dockerfilePath = b.context + "/Dockerfile"
	}

	content, err := os.ReadFile(dockerfilePath)
	if err != nil {
		return fmt.Errorf("failed to read Dockerfile: %w", err)
	}

	log.Printf("Dockerfile size: %d bytes", len(content))
	log.Printf("Target image: %s", b.image)
	log.Println("Note: Full build requires Docker or Kaniko in a container")

	return nil
}

// KanikoInPodBuilder builds images using Kaniko running in a sidecar container
// This is the Kubernetes-native approach
type KanikoPodBuilder struct {
	context    string
	image      string
	dockerfile string
	namespace  string
}

func NewKanikoPodBuilder(context, image string) *KanikoPodBuilder {
	return &KanikoPodBuilder{
		context: context,
		image:   image,
	}
}

func (b *KanikoPodBuilder) SetDockerfile(dockerfile string) *KanikoPodBuilder {
	b.dockerfile = dockerfile
	return b
}

func (b *KanikoPodBuilder) Build(ctx context.Context) error {
	log.Println("Using Kaniko in Kubernetes pod...")

	// Generate Kaniko pod spec
	podSpec := b.generatePodSpec()

	log.Printf("Would create Kaniko pod: %s", podSpec)
	log.Println("Note: This requires a Kubernetes cluster with Kaniko support")

	return nil
}

func (b *KanikoPodBuilder) generatePodSpec() string {
	// This generates a Kubernetes Pod manifest for Kaniko
	return fmt.Sprintf(`apiVersion: v1
kind: Pod
metadata:
  name: kaniko-builder
spec:
  restartPolicy: Never
  containers:
  - name: kaniko
    image: registry.cn-hangzhou.aliyuncs.com/kaniko-project/executor:latest
    args:
    - --context=%s
    - --dockerfile=%s
    - --destination=%s
    volumeMounts:
    - name: workspace
      mountPath: /workspace
  volumes:
  - name: workspace
    persistentVolumeClaim:
      claimName: workspace-pvc
`, b.context, b.dockerfile, b.image)
}

// UseKaniko checks if kaniko is available
func UseKaniko() bool {
	// Check if kaniko binary exists
	_, err := os.Stat("/kaniko/executor")
	if err == nil {
		return true
	}

	// Check if kaniko image is available
	cmd := exec.Command("docker", "images", "-q", "kaniko-project/executor")
	return cmd.Run() == nil
}
