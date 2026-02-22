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

// KanikoLib Go 库直接Builder 使用 Kaniko构建镜像
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
		CustomPlatform:   platforms.Format(platforms.Normalize(platforms.DefaultSpec())),
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
		SrcContext:     b.context,
		DockerfilePath: b.dockerfile,
	}
}

// UseKanikoLib 检查是否可以使用 Kaniko 库
func UseKanikoLib() bool {
	return true // Kaniko 库总是可用
}
