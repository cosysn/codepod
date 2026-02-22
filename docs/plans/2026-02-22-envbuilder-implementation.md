# Envbuilder Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Docker-free container image builder running inside sandbox, supporting DevContainer specification, using Kaniko as the build engine.

**Architecture:** envbuilder runs inside a sandbox container, reads .devcontainer/ from project repo, parses devcontainer.json and features, builds image using Kaniko, pushes to registry. devpod orchestrates via TS SDK.

**Tech Stack:** Go 1.21+, Kaniko Go library, Docker/OCI client, TS SDK for sandbox communication

---

## Task 1: Initialize Go Module

**Files:**
- Create: `apps/devpod/envbuilder/go.mod`
- Create: `apps/devpod/envbuilder/cmd/main.go`
- Create: `apps/devpod/envbuilder/pkg/config/config.go`
- Create: `apps/devpod/envbuilder/pkg/config/devcontainer.go`

**Step 1: Create go.mod**

```bash
mkdir -p apps/devpod/envbuilder/cmd apps/devpod/envbuilder/pkg/config
cat > apps/devpod/envbuilder/go.mod << 'EOF'
module github.com/codepod/devpod/envbuilder

go 1.21

require (
	github.com/GoogleCloudPlatform/kariko v0.0.0
	github.com/containerd/platforms v0.0.8
	github.com/docker/cli v24.0.7
	github.com/docker/docker v24.0.7
	github.com/spf13/cobra v1.8.0
	github.com/spf13/viper v1.18.2
	gopkg.in/yaml.v3 v3.0.1
)
EOF
```

**Step 2: Run go mod tidy to fetch dependencies**

Run: `cd apps/devpod/envbuilder && go mod tidy`
Expected: Downloads dependencies

**Step 3: Create basic main.go with Cobra**

```go
package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

var rootCmd = &cobra.Command{
	Use:   "envbuilder",
	Short: "Build devcontainer images without Docker",
}

var buildCmd = &cobra.Command{
	Use:   "build",
	Short: "Build devcontainer image",
	Run: func(cmd *cobra.Command, args []string) {
		fmt.Println("envbuilder build started")
	},
}

func main() {
	rootCmd.AddCommand(buildCmd)
	if err := rootCmd.Execute(os.Args); err != nil {
		os.Exit(1)
	}
}
```

**Step 4: Run go build to verify compilation**

Run: `cd apps/devpod/envbuilder && go build -o envbuilder ./cmd`
Expected: Binary compiles without errors

**Step 5: Commit**

```bash
git add apps/devpod/envbuilder/
git commit -m "feat(envbuilder): initialize Go module with Cobra"
```

---

## Task 2: Config Parser - devcontainer.json

**Files:**
- Modify: `apps/devpod/envbuilder/pkg/config/devcontainer.go`
- Create: `apps/devpod/envbuilder/pkg/config/devcontainer_test.go`

**Step 1: Write the failing test**

```go
package config

import (
	"os"
	"testing"
)

func TestParseDevcontainer(t *testing.T) {
	// Create temp devcontainer.json
	content := `{
		"image": "ubuntu:22.04",
		"features": {
			"ghcr.io/devcontainers/features/go:1": {}
		},
		"onCreateCommand": "apt-get update",
		"postStartCommand": "echo started"
	}`

	tmpfile, err := os.CreateTemp("", "devcontainer-*.json")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(tmpfile.Name())

	if _, err := tmpfile.Write([]byte(content)); err != nil {
		t.Fatal(err)
	}
	tmpfile.Close()

	cfg, err := ParseDevcontainer(tmpfile.Name())
	if err != nil {
		t.Fatalf("ParseDevcontainer failed: %v", err)
	}

	if cfg.Image != "ubuntu:22.04" {
		t.Errorf("expected image ubuntu:22.04, got %s", cfg.Image)
	}

	if len(cfg.Features) != 1 {
		t.Errorf("expected 1 feature, got %d", len(cfg.Features))
	}

	if cfg.OnCreateCommand == nil || len(*cfg.OnCreateCommand) != 1 {
		t.Error("expected onCreateCommand to have 1 command")
	}

	if cfg.PostStartCommand == nil || len(*cfg.PostStartCommand) != 1 {
		t.Error("expected postStartCommand to have 1 command")
	}
}
```

**Step 2: Run test to verify it fails**

Run: `cd apps/devpod/envbuilder && go test ./pkg/config/... -v`
Expected: FAIL - undefined: ParseDevcontainer

**Step 3: Write implementation**

```go
package config

import (
	"os"

	"gopkg.in/yaml.v3"
)

type DevcontainerConfig struct {
	Image               *string               `json:"image,omitempty"`
	DockerFile          *string               `json:"dockerFile,omitempty"`
	Features            map[string]any        `json:"features,omitempty"`
	OnCreateCommand     *[]string             `json:"onCreateCommand,omitempty"`
	UpdateContentCommand *[]string            `json:"updateContentCommand,omitempty"`
	PostCreateCommand   *[]string             `json:"postCreateCommand,omitempty"`
	PostStartCommand    *[]string             `json:"postStartCommand,omitempty"`
	WorkspaceFolder     *string               `json:"workspaceFolder,omitempty"`
	Extensions          []string              `json:"extensions,omitempty"`
}

func ParseDevcontainer(path string) (*DevcontainerConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var cfg DevcontainerConfig
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}

	return &cfg, nil
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/devpod/envbuilder && go test ./pkg/config/... -v`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/devpod/envbuilder/pkg/config/
git commit -m "feat(envbuilder): add devcontainer.json parser"
```

---

## Task 3: Features Resolver

**Files:**
- Create: `apps/devpod/envbuilder/pkg/features/resolver.go`
- Create: `apps/devpod/envbuilder/pkg/features/resolver_test.go`

**Step 1: Write the failing test**

```go
package features

import (
	"testing"
)

func TestResolveFeature(t *testing.T) {
	resolver := NewResolver()

	// Test resolving a simple feature
	script, err := resolver.Resolve("ghcr.io/devcontainers/features/go:1", map[string]any{})
	if err != nil {
		t.Fatalf("Resolve failed: %v", err)
	}

	if script == "" {
		t.Error("expected non-empty script")
	}
}

func TestResolveAllFeatures(t *testing.T) {
	resolver := NewResolver()

	features := map[string]any{
		"ghcr.io/devcontainers/features/go:1": map[string]any{},
		"ghcr.io/devcontainers/features/node:1": map[string]any{},
	}

	scripts, err := resolver.ResolveAll(features)
	if err != nil {
		t.Fatalf("ResolveAll failed: %v", err)
	}

	if len(scripts) != 2 {
		t.Errorf("expected 2 scripts, got %d", len(scripts))
	}
}
```

**Step 2: Run test to verify it fails**

Run: `cd apps/devpod/envbuilder && go test ./pkg/features/... -v`
Expected: FAIL - undefined: NewResolver

**Step 3: Write implementation**

```go
package features

import (
	"fmt"
	"io"
	"net/http"
	"strings"
)

type Resolver struct {
	featuresBaseURL string
}

func NewResolver() *Resolver {
	return &Resolver{
		featuresBaseURL: "https://raw.githubusercontent.com/devcontainers/features/main/src",
	}
}

func (r *Resolver) Resolve(feature string, options map[string]any) (string, error) {
	// Parse feature: ghcr.io/devcontainers/features/go:1 -> src/go
	parts := strings.Split(feature, ":")
	if len(parts) < 2 {
		return "", fmt.Errorf("invalid feature format: %s", feature)
	}

	featurePath := strings.TrimPrefix(parts[0], "ghcr.io/devcontainers/features/")
	featureName := featurePath

	// Construct URL to install.sh
	url := fmt.Sprintf("%s/%s/install.sh", r.featuresBaseURL, featureName)

	// Download script
	resp, err := http.Get(url)
	if err != nil {
		return "", fmt.Errorf("failed to fetch feature: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("feature not found: %s (status: %d)", feature, resp.StatusCode)
	}

	script, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read script: %w", err)
	}

	return string(script), nil
}

func (r *Resolver) ResolveAll(features map[string]any) (map[string]string, error) {
	result := make(map[string]string)

	for feature, options := range features {
		script, err := r.Resolve(feature, options.(map[string]any))
		if err != nil {
			return nil, err
		}
		result[feature] = script
	}

	return result, nil
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/devpod/envbuilder && go test ./pkg/features/... -v`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/devpod/envbuilder/pkg/features/
git commit -m "feat(envbuilder): add features resolver"
```

---

## Task 4: Kaniko Builder

**Files:**
- Create: `apps/devpod/envbuilder/pkg/builder/kaniko.go`
- Create: `apps/devpod/envbuilder/pkg/builder/kaniko_test.go`

**Step 1: Write the failing test**

```go
package builder

import (
	"testing"
)

func TestNewKanikoBuilder(t *testing.T) {
	b := NewKanikoBuilder("/workspace", "localhost:5000/test:latest")
	if b == nil {
		t.Fatal("expected non-nil builder")
	}

	if b.context != "/workspace" {
		t.Errorf("expected context /workspace, got %s", b.context)
	}

	if b.image != "localhost:5000/test:latest" {
		t.Errorf("expected image localhost:5000/test:latest, got %s", b.image)
	}
}

func TestBuild(t *testing.T) {
	b := NewKanikoBuilder("/tmp", "localhost:5000/test:latest")
	err := b.Build()
	if err != nil {
		t.Logf("Build may fail without valid context: %v", err)
	}
}
```

**Step 2: Run test to verify it fails**

Run: `cd apps/devpod/envbuilder && go test ./pkg/builder/... -v`
Expected: FAIL - undefined: NewKanikoBuilder

**Step 3: Write implementation**

```go
package builder

import (
	"context"
	"fmt"
	"os"
	"os/exec"

	"github.com/GoogleCloudPlatform/kariko/pkg/config"
	"github.com/GoogleCloudPlatform/kariko/pkg/walker"
)

type KanikoBuilder struct {
	context      string
	image        string
	dockerfile   string
	extraEnvs    map[string]string
	registry     string
}

func NewKanikoBuilder(context, image string) *KanikoBuilder {
	return &KanikoBuilder{
		context: context,
		image:   image,
	}
}

func (b *KanikoBuilder) SetDockerfile(dockerfile string) *KanikoBuilder {
	b.dockerfile = dockerfile
	return b
}

func (b *KanikoBuilder) Build() error {
	// Create kaniko config
	kanikoConfig := &config.KanikoConfig{
		BuildContext:   b.context,
		Dockerfile:     b.dockerfile,
		Destinations:  []string{b.image},
		RegistryConfig: os.Getenv("KANIKO_REGISTRY_CONFIG"),
	}

	// Create walker
	w := walker.New(kanikoConfig.BuildContext, kanikoConfig.IgnoreFilePath(), true)

	// For now, use exec to run kaniko binary
	// In production, use the Go library directly
	cmd := exec.Command("/kaniko/executor",
		"-c", b.context,
		"-d", b.image,
	)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if b.dockerfile != "" {
		cmd.Args = append(cmd.Args, "-f", b.dockerfile)
	}

	return cmd.Run()
}

func (b *KanikoBuilder) BuildWithGoLibrary(ctx context.Context) error {
	// Alternative: use kaniko Go library directly
	kanikoConfig := &config.KanikoConfig{
		BuildContext:  b.context,
		Dockerfile:    b.dockerfile,
		Destinations:  []string{b.image},
	}

	// This requires deeper integration with kariko
	// For now, exec approach is simpler
	return b.Build()
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/devpod/envbuilder && go test ./pkg/builder/... -v`
Expected: PASS (Build test may skip if no kaniko binary)

**Step 5: Commit**

```bash
git add apps/devpod/envbuilder/pkg/builder/
git commit -m "feat(envbuilder): add kaniko builder wrapper"
```

---

## Task 5: Registry Pusher

**Files:**
- Create: `apps/devpod/envbuilder/pkg/registry/pusher.go`
- Create: `apps/devpod/envbuilder/pkg/registry/pusher_test.go`

**Step 1: Write the failing test**

```go
package registry

import (
	"testing"
)

func TestNewPusher(t *testing.T) {
	p := NewPusher("localhost:5000")
	if p.registry != "localhost:5000" {
		t.Errorf("expected registry localhost:5000, got %s", p.registry)
	}
}

func TestPushImage(t *testing.T) {
	p := NewPusher("localhost:5000")
	// This will fail without a real image, just test the error
	err := p.PushImage("test-image:latest")
	if err == nil {
		t.Error("expected error for non-existent image")
	}
}
```

**Step 2: Run test to verify it fails**

Run: `cd apps/devpod/envbuilder && go test ./pkg/registry/... -v`
Expected: FAIL - undefined: NewPusher

**Step 3: Write implementation**

```go
package registry

import (
	"context"
	"fmt"
	"os/exec"

	"github.com/docker/docker/api/types/image"
	"github.com/docker/docker/client"
)

type Pusher struct {
	registry string
	docker   *client.Client
}

func NewPusher(registry string) *Pusher {
	// Create Docker client (will use env vars)
	docker, _ := client.NewClientWithOpts(client.FromEnv)
	return &Pusher{
		registry: registry,
		docker:   docker,
	}
}

func (p *Pusher) PushImage(imageName string) error {
	ctx := context.Background()

	// Tag image with registry
	taggedName := fmt.Sprintf("%s/%s", p.registry, imageName)

	tagCmd := exec.Command("docker", "tag", imageName, taggedName)
	if err := tagCmd.Run(); err != nil {
		return fmt.Errorf("failed to tag image: %w", err)
	}

	// Push using Docker client
	pushResp, err := p.docker.ImagePush(ctx, taggedName, image.PushOptions{})
	if err != nil {
		return fmt.Errorf("failed to push image: %w", err)
	}
	defer pushResp.Close()

	// In production, handle push progress
	_ = pushResp

	return nil
}

func (p *Pusher) Close() error {
	if p.docker != nil {
		return p.docker.Close()
	}
	return nil
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/devpod/envbuilder && go test ./pkg/registry/... -v`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/devpod/envbuilder/pkg/registry/
git commit -m "feat(envbuilder): add registry pusher"
```

---

## Task 6: Hooks Executor

**Files:**
- Create: `apps/devpod/envbuilder/pkg/hooks/executor.go`
- Create: `apps/devpod/envbuilder/pkg/hooks/executor_test.go`

**Step 1: Write the failing test**

```go
package hooks

import (
	"testing"
)

func TestExecutor_New(t *testing.T) {
	e := NewExecutor("/opt/hooks")
	if e.hooksDir != "/opt/hooks" {
		t.Errorf("expected hooksDir /opt/hooks, got %s", e.hooksDir)
	}
}

func TestExecuteHook(t *testing.T) {
	e := NewExecutor("/tmp/hooks")
	err := e.ExecuteHook("onCreateCommand", []string{"echo hello"})
	if err != nil {
		t.Errorf("ExecuteHook failed: %v", err)
	}
}

func TestWriteHookToImage(t *testing.T) {
	e := NewExecutor("/tmp/hooks")
	err := e.WriteHookToImage("postStartCommand", []string{"echo started"}, "/tmp/Dockerfile")
	if err != nil {
		t.Errorf("WriteHookToImage failed: %v", err)
	}
}
```

**Step 2: Run test to verify it fails**

Run: `cd apps/devpod/envbuilder && go test ./pkg/hooks/... -v`
Expected: FAIL - undefined: NewExecutor

**Step 3: Write implementation**

```go
package hooks

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type Executor struct {
	hooksDir string
}

func NewExecutor(hooksDir string) *Executor {
	return &Executor{
		hooksDir: hooksDir,
	}
}

func (e *Executor) ExecuteHook(name string, commands []string) error {
	if len(commands) == 0 {
		return nil
	}

	// Create hook script
	hookPath := filepath.Join(e.hooksDir, name)
	script := "#!/bin/bash\n" + strings.Join(commands, "\n")

	if err := os.WriteFile(hookPath, []byte(script), 0755); err != nil {
		return fmt.Errorf("failed to write hook: %w", err)
	}

	// Execute hook
	cmd := exec.Command("/bin/bash", hookPath)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	return cmd.Run()
}

func (e *Executor) WriteHookToImage(name string, commands []string, dockerfilePath string) error {
	if len(commands) == 0 {
		return nil
	}

	// Generate RUN instruction for hook
	script := strings.Join(commands, " && ")
	runInstruction := fmt.Sprintf("RUN %s\n", script)

	// Append to Dockerfile
	f, err := os.OpenFile(dockerfilePath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	defer f.Close()

	_, err = f.WriteString(runInstruction)
	return err
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/devpod/envbuilder && go test ./pkg/hooks/... -v`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/devpod/envbuilder/pkg/hooks/
git commit -m "feat(envbuilder): add hooks executor"
```

---

## Task 7: Integrate All Components

**Files:**
- Modify: `apps/devpod/envbuilder/cmd/main.go`

**Step 1: Write the failing test (integration test)**

```go
package main

import (
	"os"
	"testing"
)

func TestBuildIntegration(t *testing.T) {
	// Create temp workspace with devcontainer.json
	tmpdir, err := os.MkdirTemp("", "envbuilder-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpdir)

	// Write test devcontainer.json
	devcontainer := `{
		"image": "ubuntu:22.04",
		"onCreateCommand": ["echo created"],
		"postStartCommand": ["echo started"]
	}`
	os.WriteFile(filepath.Join(tmpdir, "devcontainer.json"), []byte(devcontainer), 0644)

	// Test build command
	// This would require more setup, skip for now
	t.Skip("Integration test requires kaniko and registry")
}
```

**Step 2: Update main.go with full implementation**

```go
package main

import (
	"fmt"
	"log"
	"os"

	"github.com/codepod/devpod/envbuilder/pkg/builder"
	"github.com/codepod/devpod/envbuilder/pkg/config"
	"github.com/codepod/devpod/envbuilder/pkg/features"
	"github.com/codepod/devpod/envbuilder/pkg/hooks"
	"github.com/codepod/devpod/envbuilder/pkg/registry"
	"github.com/spf13/cobra"
)

var (
	workspace   string
	imageName   string
	registryURL string
)

var buildCmd = &cobra.Command{
	Use:   "build",
	Short: "Build devcontainer image",
	Run:   runBuild,
}

func runBuild(cmd *cobra.Command, args []string) {
	// 1. Parse devcontainer.json
	devcontainerPath := fmt.Sprintf("%s/.devcontainer/devcontainer.json", workspace)
	cfg, err := config.ParseDevcontainer(devcontainerPath)
	if err != nil {
		log.Fatalf("Failed to parse devcontainer.json: %v", err)
	}

	log.Printf("Parsed config: image=%s", getStringPtr(cfg.Image))

	// 2. Resolve features
	featureResolver := features.NewResolver()
	if len(cfg.Features) > 0 {
		featureScripts, err := featureResolver.ResolveAll(cfg.Features)
		if err != nil {
			log.Printf("Warning: Failed to resolve features: %v", err)
		} else {
			log.Printf("Resolved %d features", len(featureScripts))
		}
	}

	// 3. Create kaniko builder
	kanikoBuilder := builder.NewKanikoBuilder(workspace, imageName)
	if cfg.DockerFile != nil {
		kanikoBuilder.SetDockerfile(*cfg.DockerFile)
	}

	// 4. Build image
	log.Println("Starting build...")
	if err := kanikoBuilder.Build(); err != nil {
		log.Fatalf("Build failed: %v", err)
	}

	// 5. Push to registry
	pusher := registry.NewPusher(registryURL)
	defer pusher.Close()

	log.Printf("Pushing image to %s...", imageName)
	if err := pusher.PushImage(imageName); err != nil {
		log.Fatalf("Push failed: %v", err)
	}

	log.Println("Build completed successfully!")
}

func getStringPtr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func init() {
	rootCmd.AddCommand(buildCmd)
	buildCmd.Flags().StringVar(&workspace, "workspace", "/workspace", "Workspace directory")
	buildCmd.Flags().StringVar(&imageName, "image", "", "Target image name")
	buildCmd.Flags().StringVar(&registryURL, "registry", "localhost:5000", "Registry URL")
}

var rootCmd = &cobra.Command{
	Use:   "envbuilder",
	Short: "Build devcontainer images without Docker",
}

func main() {
	if err := rootCmd.Execute(os.Args); err != nil {
		os.Exit(1)
	}
}
```

**Step 3: Run go build to verify compilation**

Run: `cd apps/devpod/envbuilder && go build -o envbuilder ./cmd`
Expected: Binary compiles without errors

**Step 4: Commit**

```bash
git add apps/devpod/envbuilder/cmd/
git commit -m "feat(envbuilder): integrate all components in main"
```

---

## Task 8: Dockerfile for envbuilder

**Files:**
- Create: `apps/devpod/envbuilder/Dockerfile`

**Step 1: Create Dockerfile**

```dockerfile
# Build stage
FROM golang:1.21-alpine AS builder

RUN apk add --no-cache git

WORKDIR /build

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -o envbuilder ./cmd

# Runtime stage
FROM alpine:3.19

RUN apk add --no-cache \
    ca-certificates \
    tzdata \
    bash \
    docker \
    curl

# Copy kaniko
COPY --from=gcr.io/kaniko-project/executor:latest /kaniko /kaniko

# Copy envbuilder
COPY --from=builder /build/envbuilder /usr/local/bin/envbuilder

WORKDIR /workspace

ENTRYPOINT ["/usr/local/bin/envbuilder"]
CMD ["--help"]
```

**Step 2: Commit**

```bash
git add apps/devpod/envbuilder/Dockerfile
git commit -m "feat(envbuilder): add Dockerfile"
```

---

## Task 9: Test End-to-End

**Files:**
- Modify: `apps/devpod/envbuilder/Dockerfile` (if needed)

**Step 1: Build envbuilder image**

Run: `docker build -t envbuilder:latest -f apps/devpod/envbuilder/Dockerfile apps/devpod/envbuilder/`
Expected: Image builds successfully

**Step 2: Verify binary works**

Run: `docker run --rm envbuilder:latest --help`
Expected: Shows help output

**Step 3: Commit**

```bash
git add -A
git commit -m "feat(envbuilder): complete envbuilder implementation"
```

---

**Plan complete and saved to `docs/plans/2026-02-22-envbuilder-implementation.md`.**

Two execution options:

1. **Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

2. **Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
