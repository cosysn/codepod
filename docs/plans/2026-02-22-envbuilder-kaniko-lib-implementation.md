# Envbuilder Kaniko Go 库实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 使用 Kaniko Go 库直接构建镜像，无需 Docker socket，支持 registry mirror

**Architecture:** 直接在进程内调用 Kaniko 库函数 (executor.DoBuild, executor.DoPush)，替代当前通过 docker run 运行 Kaniko 容器的方式

**Tech Stack:**
- Go
- Kaniko (GoogleContainerTools/kaniko)
- DevContainer spec

---

## Task 1: 添加 Kaniko 依赖

**Files:**
- Modify: `apps/devpod/envbuilder/go.mod`
- Modify: `apps/devpod/envbuilder/go.sum` (自动生成)

**Step 1: 添加依赖**

```bash
cd /home/ubuntu/codepod/apps/devpod/envbuilder
go get github.com/GoogleContainerTools/kaniko/pkg/config@v1.9.2
go get github.com/GoogleContainerTools/kaniko/pkg/executor@v1.9.2
go get github.com/GoogleContainerTools/kaniko/pkg/util@v1.9.2
go get github.com/google/go-containerregistry/pkg/v1/remote
go get github.com/containerd/platforms
```

**Step 2: 验证依赖**

Run: `go mod tidy`
Expected: 依赖添加到 go.mod

**Step 3: Commit**

```bash
git add go.mod go.sum
git commit -m "deps: add kaniko dependencies"
```

---

## Task 2: 创建 Kaniko 库调用模块

**Files:**
- Create: `apps/devpod/envbuilder/pkg/builder/kaniko_lib.go`

**Step 1: 写入 kaniko_lib.go**

```go
package builder

import (
	"context"
	"fmt"
	"os"

	"github.com/GoogleContainerTools/kaniko/pkg/config"
	"github.com/GoogleContainerTools/kaniko/pkg/executor"
	"github.com/GoogleContainerTools/kaniko/pkg/util"
	"github.com/containerd/platforms"
	"github.com/google/go-containerregistry/pkg/v1/remote"
)

// KanikoLibBuilder 使用 Kaniko Go 库直接构建镜像
type KanikoLibBuilder struct {
	context        string
	image          string
	dockerfile     string
	registryMirror string
	buildArgs      map[string]string
	stdout         *os.File
	stderr         *os.File
}

func NewKanikoLibBuilder(context, image string) *KanikoLibBuilder {
	return &KanikoLibBuilder{
		context: context,
		image:   image,
		stdout:  os.Stdout,
		stderr:  os.Stderr,
	}
}

func (b *KanikoLibBuilder) SetDockerfile(dockerfile string) *KanikoLibBuilder {
	b.dockerfile = dockerfile
	return b
}

func (b *KanikoLibBuilder) SetRegistryMirror(mirror string) *KanikoLibBuilder {
	b.registryMirror = mirror
	return b
}

func (b *KanikoLibBuilder) SetStdout(w *os.File) *KanikoLibBuilder {
	b.stdout = w
	return b
}

func (b *KanikoLibBuilder) SetStderr(w *os.File) *KanikoLibBuilder {
	b.stderr = w
	return b
}

func (b *KanikoLibBuilder) Build(ctx context.Context) error {
	fmt.Fprintf(b.stdout, "Building image with Kaniko library...\n")

	// 生成 Kaniko 配置
	kOpts := b.generateKanikoOptions()

	// 添加忽略路径
	util.AddToDefaultIgnoreList(util.IgnoreListEntry{
		Path:            b.context,
		PrefixMatchOnly: false,
	})

	// 执行构建
	image, err := executor.DoBuild(kOpts)
	if err != nil {
		return fmt.Errorf("kaniko build failed: %w", err)
	}

	// 推送镜像
	fmt.Fprintf(b.stdout, "Pushing image to registry...\n")
	if err := executor.DoPush(image, kOpts); err != nil {
		return fmt.Errorf("kaniko push failed: %w", err)
	}

	fmt.Fprintf(b.stdout, "Build and push completed!\n")
	return nil
}

func (b *KanikoLibBuilder) generateKanikoOptions() *config.KanikoOptions {
	// 配置 registry mirrors
	var registryMirrors []string
	if b.registryMirror != "" {
		registryMirrors = []string{b.registryMirror}
	}

	return &config.KanikoOptions{
		CustomPlatform:  platforms.Format(platforms.Normalize(platforms.DefaultSpec())),
		SnapshotMode:    "redo",
		RunV2:           true,
		RunStdout:       b.stdout,
		RunStderr:       b.stderr,
		Destinations:    []string{b.image},
		NoPush:          false,
		BuildArgs:       b.buildArgs,
		RegistryOptions: config.RegistryOptions{
			RegistryMirrors: registryMirrors,
		},
		SrcContext: b.context,
		DockerfilePath: b.dockerfile,
	}
}

// UseKanikoLib 检查是否可以使用 Kaniko 库
func UseKanikoLib() bool {
	return true // Kaniko 库总是可用
}
```

**Step 2: Commit**

```bash
git add pkg/builder/kaniko_lib.go
git commit -m "feat: add kaniko library builder implementation"
```

---

## Task 3: 更新 main.go 使用新的 builder

**Files:**
- Modify: `apps/devpod/envbuilder/cmd/main.go`

**Step 1: 修改 builder 选择逻辑**

将当前的 builder 选择逻辑替换为:

```go
// 7. Build image using Kaniko library (无需 Docker)
fmt.Println("Starting build...")

var buildErr error
if builder.UseKanikoLib() {
    fmt.Println("Using Kaniko library (no Docker required)...")
    kanikoBuilder := builder.NewKanikoLibBuilder(workspace, imageName)
    kanikoBuilder.SetDockerfile(dockerfilePath)
    if baseImage != "" {
        // 替换基础镜像需要修改 Dockerfile
        if err := builder.ReplaceBaseImage(workspace, baseImage); err != nil {
            fmt.Printf("Warning: Failed to replace base image: %v\n", err)
        }
    }
    if registryMirror != "" {
        kanikoBuilder.SetRegistryMirror(registryMirror)
    }
    buildErr = kanikoBuilder.Build(ctx)
} else {
    buildErr = fmt.Errorf("no builder available")
}

if buildErr != nil {
    log.Fatalf("Build failed: %v", buildErr)
}
```

**Step 2: Commit**

```bash
git add cmd/main.go
git commit -m "feat: use kaniko library builder by default"
```

---

## Task 4: 测试构建

**Files:**
- Test: `apps/devpod/envbuilder`

**Step 1: 重新构建 envbuilder**

```bash
cd /home/ubuntu/codepod/apps/devpod/envbuilder
GOWORK=off CGO_ENABLED=0 go build -o envbuilder ./cmd
```

**Step 2: 构建 Docker 镜像**

```bash
docker build -t codepod/envbuilder:test .
```

**Step 3: 测试构建 (需要 Docker socket)**

```bash
docker run --rm -v /home/ubuntu/codepod:/workspace \
  -v /var/run/docker.sock:/var/run/docker.sock \
  codepod/envbuilder:test build \
  --workspace /workspace \
  --image test:latest \
  --base-image registry.cn-hangzhou.aliyuncs.com/acs/ubuntu:22.04 \
  --registry-mirror https://registry.docker-cn.com
```

Expected: 构建成功，镜像推送到 registry

**Step 4: Commit**

```bash
git add -A
git commit -m "test: verify kaniko library build works"
```

---

## Task 5: 清理旧代码 (可选)

**Files:**
- Delete: `apps/devpod/envbuilder/pkg/builder/kaniko.go`
- Delete: `apps/devpod/envbuilder/pkg/builder/kaniko_container.go`
- Delete: `apps/devpod/envbuilder/pkg/builder/buildah.go`
- Delete: `apps/devpod/envbuilder/pkg/builder/rootless.go`

如果新实现工作正常，可以删除旧的实现文件。

---

## 执行方式

1. Subagent-Driven - 当前 session 中执行
2. Parallel Session - 新开 session 执行
