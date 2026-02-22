package builder

import (
	"context"
	"fmt"
	"os"
	"strings"

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

	// 设置 registry mirror 环境变量 - 必须在任何 Kaniko 代码之前设置
	// 这样 Kaniko 内部的 registry client 可以读取这个环境变量
	if b.registryMirror != "" {
		// 转换逗号为分号 (Kaniko 要求的格式)
		mirrorStr := strings.ReplaceAll(b.registryMirror, ",", ";")
		os.Setenv("KANIKO_REGISTRY_MIRROR", mirrorStr)
		fmt.Printf("Set KANIKO_REGISTRY_MIRROR=%s\n", mirrorStr)
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
	// Configure registry mirrors - support comma or semicolon-separated values
	var registryMirrors []string

	if b.registryMirror != "" {
		// Support both comma and semicolon separators (Kaniko uses semicolon)
		// Replace commas with semicolons for consistency
		mirrorStr := strings.ReplaceAll(b.registryMirror, ",", ";")
		mirrors := strings.Split(mirrorStr, ";")
		for _, m := range mirrors {
			m = strings.TrimSpace(m)
			if m != "" {
				registryMirrors = append(registryMirrors, m)
			}
		}
	}

	// Set KANIKO_REGISTRY_MIRROR environment variable (Kaniko checks this)
	// Format: mirror1;mirror2 (semicolon separated)
	if len(registryMirrors) > 0 {
		os.Setenv("KANIKO_REGISTRY_MIRROR", strings.Join(registryMirrors, ";"))
	}

	// Also set cache directory if provided
	if b.baseImageCacheDir != "" {
		os.Setenv("KANIKO_CACHE_DIR", b.baseImageCacheDir)
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
	}
}
