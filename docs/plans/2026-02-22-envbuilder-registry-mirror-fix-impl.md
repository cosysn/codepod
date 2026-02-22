# envbuilder Registry Mirror Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Fix registry mirror configuration and add base image cache support to enable building images in China network environment.

**Architecture:** Add --base-image-cache-dir flag to allow pre-loading base images, fix Kaniko registry mirror configuration to work properly with Chinese mirrors.

**Tech Stack:** Go 1.25, Kaniko v1.23.2

---

## Task 1: Add --base-image-cache-dir flag to CLI

**Files:**
- Modify: `apps/devpod/envbuilder/cmd/main.go:1-162`
- Test: Build binary and verify flag appears in help

**Step 1: Add baseImageCacheDir variable**

Add to the var block around line 17:
```go
var (
    workspace            string
    imageName           string
    registryURL         string
    registryMirror      string
    baseImageCacheDir   string  // NEW
)
```

**Step 2: Add flag registration**

Add after line 150:
```go
buildCmd.Flags().StringVar(&baseImageCacheDir, "base-image-cache-dir", "", "Path to directory containing cached base images")
```

**Step 3: Pass to Kaniko builder**

After line 109 (kanikoBuilder creation), add:
```go
if baseImageCacheDir != "" {
    kanikoBuilder.SetBaseImageCacheDir(baseImageCacheDir)
}
```

**Step 4: Build and verify**

```bash
docker run --rm -v /home/ubuntu/codepod/apps/devpod/envbuilder:/workspace -v /tmp/build-output:/output --entrypoint /bin/sh codepod/envbuilder:test -c "export GOPROXY=https://goproxy.cn,direct && cd /workspace && /usr/local/go/bin/go build -o /output/envbuilder ./cmd"
cp /tmp/build-output/envbuilder /home/ubuntu/codepod/apps/devpod/envbuilder/envbuilder
docker build -t codepod/envbuilder:test /home/ubuntu/codepod/apps/devpod/envbuilder
docker run --rm codepod/envbuilder:test build --help
```

Expected: `--base-image-cache-dir` appears in help output

**Step 5: Commit**

```bash
git add apps/devpod/envbuilder/cmd/main.go
git commit -m "feat(envbuilder): add --base-image-cache-dir flag

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Add BaseImageCacheDir to KanikoLibBuilder

**Files:**
- Modify: `apps/devpod/envbuilder/pkg/builder/kaniko_lib.go:1-100`

**Step 1: Add field to struct**

After line 18 (registryMirror field), add:
```go
type KanikoLibBuilder struct {
    context            string
    image             string
    dockerfile        string
    registryMirror    string
    baseImageCacheDir string  // NEW
    buildArgs         []string
}
```

**Step 2: Add setter method**

After line 36 (SetRegistryMirror method), add:
```go
func (b *KanikoLibBuilder) SetBaseImageCacheDir(dir string) *KanikoLibBuilder {
    b.baseImageCacheDir = dir
    return b
}
```

**Step 3: Update generateKanikoOptions**

In the generateKanikoOptions function, add after line 83 (before closing brace):
```go
// Add base image cache directory if provided
if b.baseImageCacheDir != "" {
    kOpts.BaseImageCacheDir = b.baseImageCacheDir
}
```

**Step 4: Add import if needed**

Check if config.KanikoOptions has BaseImageCacheDir field - it should already be available from the config package.

**Step 5: Build and verify**

```bash
docker run --rm -v /home/ubuntu/codepod/apps/devpod/envbuilder:/workspace -v /tmp/build-output:/output --entrypoint /bin/sh codepod/envbuilder:test -c "export GOPROXY=https://goproxy.cn,direct && cd /workspace && /usr/local/go/bin/go build -o /output/envbuilder ./cmd"
```

Expected: Build succeeds without errors

**Step 6: Commit**

```bash
git add apps/devpod/envbuilder/pkg/builder/kaniko_lib.go
git commit -m "feat(envbuilder): add BaseImageCacheDir to KanikoLibBuilder

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Fix registry mirror configuration

**Files:**
- Modify: `apps/devpod/envbuilder/pkg/builder/kaniko_lib.go`

**Step 1: Review current mirror configuration**

Look at how registry mirrors are currently being set in generateKanikoOptions.

**Step 2: Update to support multiple mirrors**

Replace the current registry mirror handling with support for multiple registries. The key change is to set mirrors for specific registries:

```go
func (b *KanikoLibBuilder) generateKanikoOptions() *config.KanikoOptions {
    // Configure registry mirrors - support both single mirror and multiple
    var registryMirrors []string

    if b.registryMirror != "" {
        // Support comma-separated mirrors
        mirrors := strings.Split(b.registryMirror, ",")
        for _, m := range mirrors {
            m = strings.TrimSpace(m)
            if m != "" {
                registryMirrors = append(registryMirrors, m)
            }
        }
    }

    // Set KANIKO_REGISTRY_MIRROR environment variable (Kaniko checks this)
    if len(registryMirrors) > 0 {
        os.Setenv("KANIKO_REGISTRY_MIRROR", strings.Join(registryMirrors, ","))
    }

    return &config.KanikoOptions{
        CustomPlatform: platforms.Format(platforms.Normalize(platforms.DefaultSpec())),
        SnapshotMode:   "redo",
        RunV2:          true,
        Destinations:    []string{b.image},
        NoPush:         false,
        BuildArgs:      b.buildArgs,
        RegistryOptions: config.RegistryOptions{
            RegistryMirrors: registryMirrors,
        },
        SrcContext:      b.context,
        DockerfilePath:  b.dockerfile,
        // Add cache directory if set
        BaseImageCacheDir: b.baseImageCacheDir,
    }
}
```

**Step 3: Add strings import**

Add "strings" to the imports if not present:
```go
import (
    "context"
    "fmt"
    "os"
    "strings"  // ADD THIS

    "github.com/GoogleContainerTools/kaniko/pkg/config"
    "github.com/GoogleContainerTools/kaniko/pkg/executor"
    "github.com/GoogleContainerTools/kaniko/pkg/util"
    "github.com/containerd/platforms"
)
```

**Step 4: Build and verify**

```bash
docker run --rm -v /home/ubuntu/codepod/apps/devpod/envbuilder:/workspace -v /tmp/build-output:/output --entrypoint /bin/sh codepod/envbuilder:test -c "export GOPROXY=https://goproxy.cn,direct && cd /workspace && /usr/local/go/bin/go build -o /output/envbuilder ./cmd"
```

Expected: Build succeeds

**Step 5: Commit**

```bash
git add apps/devpod/envbuilder/pkg/builder/kaniko_lib.go
git commit -m "fix(envbuilder): properly configure registry mirrors

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Test the complete implementation

**Files:**
- Test: Run full build test

**Step 1: Rebuild and test**

```bash
cp /tmp/build-output/envbuilder /home/ubuntu/codepod/apps/devpod/envbuilder/envbuilder
docker build -t codepod/envbuilder:test /home/ubuntu/codepod/apps/devpod/envbuilder
```

**Step 2: Test with Aliyun image (should work now since network is accessible)**

```bash
docker run --rm -v /tmp/test-workspace:/workspace codepod/envbuilder:test build \
    --workspace /workspace \
    --image localhost:5000/test-image:latest \
    --registry localhost:5000
```

**Step 3: Verify build output**

If successful, the image should be built and pushed to localhost:5000.

**Step 4: Commit final changes**

```bash
git add apps/devpod/envbuilder/
git commit -m "feat(envbuilder): complete registry mirror fix

- Add --base-image-cache-dir flag
- Fix registry mirror configuration
- Support multiple mirrors

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```
