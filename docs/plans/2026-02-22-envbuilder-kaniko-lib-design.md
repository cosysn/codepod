# Envbuilder 使用 Kaniko Go 库实现无 Docker 构建

> **For Claude:** Use superpowers:writing-plans skill to implement this plan.

**Goal:** 使用 Kaniko Go 库直接构建镜像，无需 Docker socket，支持 registry mirror

**Architecture:** 直接在进程内调用 Kaniko 库函数 (`executor.DoBuild`, `executor.DoPush`)，替代当前通过 docker run 运行 Kaniko 容器的方式

**Tech Stack:**
- Go
- Kaniko (GoogleContainerTools/kaniko)
- DevContainer spec

---

## 背景

当前 envbuilder 使用 `docker run` 方式运行 Kaniko 容器来构建镜像，这种方式存在问题：
1. 需要挂载 Docker socket (`/var/run/docker.sock`)
2. 镜像层存储在宿主机，路径配置复杂
3. 无法在无 Docker 环境运行

Coder Envbuilder 直接使用 Kaniko Go 库解决了这些问题。

---

## 实现方案

### 1. 添加 Kaniko 依赖

```bash
go get github.com/GoogleContainerTools/kaniko/pkg/config
go get github.com/GoogleContainerTools/kaniko/pkg/executor
go get github.com/GoogleContainerTools/kaniko/pkg/util
go get github.com/google/go-containerregistry/pkg/v1/remote
go get github.com/containerd/platforms
```

### 2. 创建 Kaniko 库调用模块

新建 `pkg/builder/kaniko_lib.go`:

```go
package builder

import (
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
}

func NewKanikoLibBuilder(context, image string) *KanikoLibBuilder {
    return &KanikoLibBuilder{
        context: context,
        image:   image,
    }
}

func (b *KanikoLibBuilder) Build(ctx context.Context) error {
    kOpts := b.generateKanikoOptions()
    image, err := executor.DoBuild(kOpts)
    if err != nil {
        return err
    }
    return executor.DoPush(image, kOpts)
}

func (b *KanikoLibBuilder) generateKanikoOptions() *config.KanikoOptions {
    return &config.KanikoOptions{
        CustomPlatform:  platforms.Format(platforms.Normalize(platforms.DefaultSpec())),
        SnapshotMode:    "redo",
        RunV2:           true,
        Destinations:    []string{b.image},
        NoPush:          false,
        RegistryOptions: config.RegistryOptions{
            RegistryMirrors: []string{b.registryMirror},
        },
        SrcContext: b.context,
    }
}
```

### 3. 修改 main.go 优先级

更新 `cmd/main.go`，Kaniko 库方式优先于 Docker socket 方式:

```go
// 优先级:
// 1. Kaniko Go 库 (无需 Docker)
// 2. Kaniko in container (需要 Docker socket)
// 3. Docker (需要 Docker daemon)
if builder.UseKanikoLib() {
    // 使用 Kaniko Go 库
}
```

### 4. 支持 Registry Mirror

通过环境变量或参数传入:

```bash
export KANIKO_REGISTRY_MIRROR="https://registry.docker-cn.com"
```

或在代码中配置:

```go
kOpts.RegistryOptions.RegistryMirrors = []string{
    "https://registry.docker-cn.com",
}
```

---

## 关键差异对比

| 特性 | 当前实现 | 新实现 |
|------|---------|--------|
| Docker 依赖 | 需要 docker socket | 无需 |
| 进程模式 | 外部进程 (docker run) | 同一进程内 |
| 镜像存储 | 宿主机 | 直接推送 registry |
| Registry Mirror | 需要重写 Dockerfile | Kaniko 原生支持 |
| 权限需求 | 普通用户 | 普通用户 |

---

## 测试验证

1. 在有 Docker socket 环境测试
2. 在无 Docker socket 环境测试
3. 测试 registry mirror 是否生效

---

## 参考实现

- Coder Envbuilder: `/home/ubuntu/envbuilder/envbuilder.go`
- Kaniko Options: `github.com/GoogleContainerTools/kaniko/pkg/config`
