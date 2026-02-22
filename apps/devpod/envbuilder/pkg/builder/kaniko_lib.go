package builder

import (
	"context"
	"fmt"
	"os"

	"github.com/GoogleContainerTools/kaniko/pkg/config"
	"github.com/GoogleContainerTools/kaniko/pkg/executor"
	"github.com/GoogleContainerTools/kaniko/pkg/util"
	"github.com/containerd/platforms"
)

// KanikoLibBuilder 使用 Kaniko Go 库直接构建镜像
type KanikoLibBuilder struct {
	context            string
	image              string
	dockerfile         string
	registryMirror     string
	baseImageCacheDir  string
	buildArgs          []string
}

func NewKanikoLibBuilder(context, image string) *KanikoLibBuilder {
	return &KanikoLibBuilder{
		context: context,
		image:   image,
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

func (b *KanikoLibBuilder) SetBaseImageCacheDir(cacheDir string) *KanikoLibBuilder {
	b.baseImageCacheDir = cacheDir
	return b
}

func (b *KanikoLibBuilder) Build(ctx context.Context) error {
	fmt.Println("Building image with Kaniko library...")

	// 设置 registry mirror 环境变量
	if b.registryMirror != "" {
		os.Setenv("KANIKO_REGISTRY_MIRROR", b.registryMirror)
		fmt.Printf("Set KANIKO_REGISTRY_MIRROR=%s\n", b.registryMirror)
	}

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
	fmt.Println("Pushing image to registry...")
	if err := executor.DoPush(image, kOpts); err != nil {
		return fmt.Errorf("kaniko push failed: %w", err)
	}

	fmt.Println("Build and push completed!")
	return nil
}

func (b *KanikoLibBuilder) generateKanikoOptions() *config.KanikoOptions {
	// 配置 registry mirrors
	var registryMirrors []string
	if b.registryMirror != "" {
		registryMirrors = []string{b.registryMirror}
	}

	// 设置 base image cache directory via environment variable
	if b.baseImageCacheDir != "" {
		os.Setenv("KANIKO_CACHE_DIR", b.baseImageCacheDir)
		fmt.Printf("Set KANIKO_CACHE_DIR=%s\n", b.baseImageCacheDir)
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
		SrcContext:     b.context,
		DockerfilePath: b.dockerfile,
	}
}
