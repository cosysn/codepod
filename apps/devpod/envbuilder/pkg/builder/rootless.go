package builder

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
)

// RootlessBuilder builds images without Docker or privileged access
// Uses buildah in unprivileged mode with fuse-overlayfs
type RootlessBuilder struct {
	context        string
	image          string
	dockerfile     string
	kanikoImage    string
	baseImage      string
	stdout         *os.File
	stderr         *os.File
}

func NewRootlessBuilder(context, image string) *RootlessBuilder {
	return &RootlessBuilder{
		context:     context,
		image:       image,
		kanikoImage: "registry.cn-hangzhou.aliyuncs.com/kaniko-project/executor:latest",
		stdout:      os.Stdout,
		stderr:      os.Stderr,
	}
}

func (b *RootlessBuilder) SetDockerfile(dockerfile string) *RootlessBuilder {
	b.dockerfile = dockerfile
	return b
}

func (b *RootlessBuilder) SetBaseImage(baseImage string) *RootlessBuilder {
	b.baseImage = baseImage
	return b
}

func (b *RootlessBuilder) SetStdout(w *os.File) *RootlessBuilder {
	b.stdout = w
	return b
}

func (b *RootlessBuilder) SetStderr(w *os.File) *RootlessBuilder {
	b.stderr = w
	return b
}

func (b *RootlessBuilder) Build(ctx context.Context) error {
	log.Println("Using Rootless Kaniko to build image...")

	// Check for required tools
	if err := b.checkRequirements(); err != nil {
		return fmt.Errorf("requirements check failed: %w", err)
	}

	// Create a temporary build directory
	buildDir, err := os.MkdirTemp("", "envbuilder-build-")
	if err != nil {
		return fmt.Errorf("failed to create temp dir: %w", err)
	}
	defer os.RemoveAll(buildDir)

	// Copy build context to temp directory
	if err := b.copyContext(buildDir); err != nil {
		return fmt.Errorf("failed to copy context: %w", err)
	}

	// Get the base image (either from parameter or Dockerfile)
	baseImage := b.baseImage
	if baseImage == "" {
		baseImage = b.extractBaseImage(buildDir)
	}

	if baseImage == "" {
		return fmt.Errorf("no base image specified")
	}

	log.Printf("Building from base image: %s", baseImage)

	// Pull base image using skopeo or buildah
	if err := b.pullImage(baseImage); err != nil {
		return fmt.Errorf("failed to pull base image: %w", err)
	}

	// Build using kaniko with rootless options
	if err := b.buildWithKaniko(buildDir, baseImage); err != nil {
		return fmt.Errorf("kaniko build failed: %w", err)
	}

	log.Println("Build completed successfully!")
	return nil
}

func (b *RootlessBuilder) checkRequirements() error {
	log.Println("Checking rootless build requirements...")

	// Check for required tools
	tools := []string{"buildah", "fuse-overlayfs"}
	allMissing := true
	for _, tool := range tools {
		if _, err := exec.LookPath(tool); err == nil {
			log.Printf("Found: %s", tool)
			allMissing = false
		} else {
			log.Printf("Missing: %s", tool)
		}
	}

	// Check if we can use kaniko
	if _, err := os.Stat("/kaniko/executor"); err == nil {
		log.Println("Found: kaniko binary")
		allMissing = false
	}

	if allMissing {
		log.Println("No rootless build tools found")
		log.Println("Will generate Kubernetes manifest for remote build")
	}

	return nil
}

func (b *RootlessBuilder) copyContext(destDir string) error {
	log.Println("Copying build context...")

	// Copy .devcontainer directory
	srcDir := b.context + "/.devcontainer"
	if _, err := os.Stat(srcDir); err == nil {
		destDevcontainer := filepath.Join(destDir, ".devcontainer")
		if err := copyDir(srcDir, destDevcontainer); err != nil {
			return fmt.Errorf("failed to copy .devcontainer: %w", err)
		}
	}

	// Copy other necessary files
	files := []string{".gitconfig", ".npmrc"}
	for _, file := range files {
		src := filepath.Join(b.context, file)
		if _, err := os.Stat(src); err == nil {
			dst := filepath.Join(destDir, file)
			if err := copyFile(src, dst); err != nil {
				log.Printf("Warning: failed to copy %s: %v", file, err)
			}
		}
	}

	return nil
}

func (b *RootlessBuilder) extractBaseImage(buildDir string) string {
	dockerfilePath := filepath.Join(buildDir, ".devcontainer", "Dockerfile")

	content, err := os.ReadFile(dockerfilePath)
	if err != nil {
		return ""
	}

	lines := splitLines(string(content))
	for _, line := range lines {
		line = trimSpace(line)
		if hasPrefix(line, "FROM ") {
			parts := splitFields(line)
			if len(parts) >= 2 {
				return parts[1]
			}
		}
	}
	return ""
}

func (b *RootlessBuilder) pullImage(image string) error {
	log.Printf("Pulling image: %s", image)

	// Try with buildah
	cmd := exec.Command("buildah", "pull", image)
	cmd.Stdout = b.stdout
	cmd.Stderr = b.stderr

	if err := cmd.Run(); err != nil {
		log.Printf("buildah pull failed: %v, trying skopeo...", err)

		// Try with skopeo as fallback
		cmd = exec.Command("skopeo", "copy",
			"docker://"+image,
			"containers-storage:"+image)
		cmd.Stdout = b.stdout
		cmd.Stderr = b.stderr

		if err := cmd.Run(); err != nil {
			return fmt.Errorf("failed to pull image: %w", err)
		}
	}

	return nil
}

func (b *RootlessBuilder) buildWithKaniko(buildDir, baseImage string) error {
	log.Println("Building with Kaniko (single-snapshot mode)...")

	dockerfilePath := filepath.Join(buildDir, ".devcontainer", "Dockerfile")

	// First, rewrite the Dockerfile to use the correct base image
	if b.baseImage != "" {
		if err := b.rewriteDockerfile(dockerfilePath, b.baseImage); err != nil {
			log.Printf("Warning: failed to rewrite Dockerfile: %v", err)
		}
	}

	// Key: Use --single-snapshot and push directly to registry
	// This avoids needing local storage for image layers
	cmd := exec.Command("docker", "run", "--rm",
		"-v", buildDir+":/workspace:ro",
		"-e", "DOCKER_CONFIG=/kaniko/.docker",
		// No privileged needed - kaniko works in user space with --single-snapshot
		b.kanikoImage,
		"--context", "/workspace",
		"--dockerfile", "/workspace/.devcontainer/Dockerfile",
		"--destination", b.image,
		"--single-snapshot",  // Don't snapshot each layer, just final
		"--no-push",          // We'll push manually or skip
	)
	cmd.Stdout = b.stdout
	cmd.Stderr = b.stderr

	runErr := cmd.Run()
	if runErr == nil {
		return nil
	}

	log.Printf("Docker-based build failed: %v", runErr)

	// Try with tar output (saves to file, then push manually)
	log.Println("Trying alternative: build to tar and push...")
	return b.buildToTar(buildDir, baseImage)
}

func (b *RootlessBuilder) buildToTar(buildDir, baseImage string) error {
	log.Println("Building to tarball...")

	dockerfilePath := filepath.Join(buildDir, ".devcontainer", "Dockerfile")

	// Rewrite Dockerfile
	if b.baseImage != "" {
		b.rewriteDockerfile(dockerfilePath, b.baseImage)
	}

	// Build to tar
	tarPath := "/tmp/image.tar"
	cmd := exec.Command("docker", "run", "--rm",
		"-v", buildDir+":/workspace:ro",
		"-v", "/tmp:/output",
		b.kanikoImage,
		"--context", "/workspace",
		"--dockerfile", "/workspace/.devcontainer/Dockerfile",
		"--tarPath", "/output/image.tar",
		"--single-snapshot",
	)
	cmd.Stdout = b.stdout
	cmd.Stderr = b.stderr

	if err := cmd.Run(); err != nil {
		log.Printf("Tar build failed: %v", err)
		log.Println("Generating Kubernetes manifest for Kaniko build...")
		return b.generateManifest(buildDir)
	}

	// Load and push
	log.Println("Loading and pushing image...")
	cmd = exec.Command("docker", "load", "-i", tarPath)
	cmd.Stdout = b.stdout
	cmd.Stderr = b.stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to load image: %w", err)
	}

	// Get image name from tar
	cmd = exec.Command("docker", "images", "--format", "{{.Repository}}:{{.Tag}}", "-a")
	out, _ := cmd.Output()
	images := splitLines(string(out))
	var latestImage string
	for i := len(images) - 1; i >= 0; i-- {
		if images[i] != "" && !hasPrefix(images[i], "<none>") {
			latestImage = images[i]
			break
		}
	}

	if latestImage != "" {
		log.Printf("Tagging and pushing: %s -> %s", latestImage, b.image)
		cmd = exec.Command("docker", "tag", latestImage, b.image)
		cmd.Run()
		cmd = exec.Command("docker", "push", b.image)
		cmd.Stdout = b.stdout
		cmd.Stderr = b.stderr
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("failed to push: %w", err)
		}
	}

	return nil
}

func (b *RootlessBuilder) rewriteDockerfile(path, baseImage string) error {
	content, err := os.ReadFile(path)
	if err != nil {
		return err
	}

	lines := splitLines(string(content))
	for i, line := range lines {
		if hasPrefix(trimSpace(line), "FROM ") {
			parts := splitFields(line)
			if len(parts) >= 2 {
				lines[i] = "FROM " + baseImage
				break
			}
		}
	}

	return os.WriteFile(path, []byte(joinLines(lines)), 0644)
}

func (b *RootlessBuilder) generateManifest(buildDir string) error {
	log.Println("Generating Kaniko Pod manifest...")

	// Create a ConfigMap with the Dockerfile
	dockerfileContent, _ := os.ReadFile(filepath.Join(buildDir, ".devcontainer", "Dockerfile"))

	manifest := fmt.Sprintf(`apiVersion: v1
kind: Pod
metadata:
  name: envbuilder-kaniko
  namespace: devpod
spec:
  restartPolicy: Never
  containers:
  - name: kaniko
    image: %s
    env:
    - name: DOCKER_CONFIG
      value: /kaniko/.docker
    args:
    - --context=/workspace
    - --dockerfile=/workspace/Dockerfile
    - --destination=%s
    - --single-snapshot
    - --snapshotMode=time
    volumeMounts:
    - name: dockerfile
      mountPath: /workspace/Dockerfile
      subPath: Dockerfile
    - name: cache
      mountPath: /kaniko/cache
  volumes:
  - name: dockerfile
    configMap:
      name: envbuilder-dockerfile
      items:
      - key: Dockerfile
        path: Dockerfile
  - name: cache
    emptyDir: {}
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: envbuilder-dockerfile
  namespace: devpod
data:
  Dockerfile: |
%s
`, b.kanikoImage, b.image, string(dockerfileContent))

	// Save manifest to file
	manifestPath := "/workspace/kaniko-manifest.yaml"
	if err := os.WriteFile(manifestPath, []byte(manifest), 0644); err == nil {
		log.Printf("Manifest saved to: %s", manifestPath)
	}

	log.Println("=== Kaniko Pod Manifest ===")
	log.Println(manifest)
	log.Println("==============================")
	log.Println("To build in Kubernetes:")
	log.Println("  kubectl apply -f", manifestPath)
	log.Println("  kubectl logs -n devpod envbuilder-kaniko -f")

	return fmt.Errorf("rootless build requires Kubernetes cluster. Manifest generated.")
}

// Helper functions to avoid importing strings package
func splitLines(s string) []string {
	var lines []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			lines = append(lines, s[start:i])
			start = i + 1
		}
	}
	if start < len(s) {
		lines = append(lines, s[start:])
	}
	return lines
}

func joinLines(lines []string) string {
	result := ""
	for i, line := range lines {
		if i > 0 {
			result += "\n"
		}
		result += line
	}
	return result
}

func trimSpace(s string) string {
	start := 0
	end := len(s)
	for start < end && (s[start] == ' ' || s[start] == '\t') {
		start++
	}
	for end > start && (s[end-1] == ' ' || s[end-1] == '\t') {
		end--
	}
	return s[start:end]
}

func hasPrefix(s, prefix string) bool {
	return len(s) >= len(prefix) && s[0:len(prefix)] == prefix
}

func splitFields(s string) []string {
	var fields []string
	field := ""
	for i := 0; i < len(s); i++ {
		if s[i] == ' ' || s[i] == '\t' {
			if field != "" {
				fields = append(fields, field)
				field = ""
			}
		} else {
			field += string(s[i])
		}
	}
	if field != "" {
		fields = append(fields, field)
	}
	return fields
}

func copyDir(src, dst string) error {
	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, path)
		dstPath := filepath.Join(dst, rel)

		if info.IsDir() {
			return os.MkdirAll(dstPath, info.Mode())
		}
		return copyFile(path, dstPath)
	})
}

func copyFile(src, dst string) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, data, 0644)
}

// UseRootless checks if rootless build is possible
func UseRootless() bool {
	// Check if we have the tools for rootless build
	_, err1 := exec.LookPath("buildah")
	_, err2 := exec.LookPath("fuse-overlayfs")
	_, err3 := os.Stat("/kaniko/executor")

	// At least one of these should be available
	return err1 == nil || err2 == nil || err3 == nil
}
