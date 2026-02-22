package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/codepod/devpod/envbuilder/pkg/builder"
	"github.com/codepod/devpod/envbuilder/pkg/config"
	"github.com/codepod/devpod/envbuilder/pkg/features"
	"github.com/codepod/devpod/envbuilder/pkg/hooks"
	"github.com/codepod/devpod/envbuilder/pkg/registry"
	"github.com/spf13/cobra"
)

var (
	workspace      string
	imageName      string
	registryURL    string
	registryMirror string
	baseImage      string
)

var buildCmd = &cobra.Command{
	Use:   "build",
	Short: "Build devcontainer image",
	Run:   runBuild,
}

func runBuild(cmd *cobra.Command, args []string) {
	ctx := context.Background()

	// Validate required flags
	if imageName == "" {
		log.Fatal("Error: --image flag is required")
	}

	// 1. Parse devcontainer.json
	devcontainerPath := fmt.Sprintf("%s/.devcontainer/devcontainer.json", workspace)
	cfg, err := config.ParseDevcontainer(devcontainerPath)
	if err != nil {
		log.Fatalf("Failed to parse devcontainer.json: %v", err)
	}

	log.Printf("Parsed config: image=%s", getStringPtr(cfg.Image))

	// 2. Replace base image if specified
	if baseImage != "" {
		log.Printf("Replacing base image with: %s", baseImage)
		if err := builder.ReplaceBaseImage(workspace, baseImage); err != nil {
			log.Printf("Warning: Failed to replace base image: %v", err)
		}
	}

	// 3. Rewrite Dockerfile to use mirror registry if configured
	if registryMirror != "" {
		log.Printf("Configuring Dockerfile to use registry mirror: %s", registryMirror)
		if err := builder.RewriteDockerfileForMirror(workspace, registryMirror); err != nil {
			log.Printf("Warning: Failed to rewrite Dockerfile: %v", err)
		}
	}

	// 4. Execute pre-build hooks
	executor := hooks.NewExecutor(workspace)
	if cfg.OnCreateCommand != nil && len(*cfg.OnCreateCommand) > 0 {
		if err := executor.ExecuteHook("prebuild", []string(*cfg.OnCreateCommand)); err != nil {
			log.Printf("Warning: Pre-build hooks failed: %v", err)
		}
	}

	// 5. Resolve features
	featureResolver := features.NewResolver()
	var featureScripts map[string]string
	if len(cfg.Features) > 0 {
		featureScripts, err = featureResolver.ResolveAll(ctx, cfg.Features)
		if err != nil {
			log.Printf("Warning: Failed to resolve features: %v", err)
		} else {
			log.Printf("Resolved %d features", len(featureScripts))
		}
	}

	// 6. Determine Dockerfile path (relative to workspace)
	dockerfilePath := ".devcontainer/Dockerfile"
	if cfg.DockerFile != nil {
		dockerfilePath = *cfg.DockerFile
		// Make it relative if it's absolute
		if strings.HasPrefix(dockerfilePath, "/") {
			rel, _ := filepath.Rel(workspace, dockerfilePath)
			dockerfilePath = rel
		}
	}

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

	// 7. Push to registry
	pusher := registry.NewPusher(registryURL)

	log.Printf("Pushing image to %s...", imageName)
	if err := pusher.PushImage(imageName); err != nil {
		log.Fatalf("Push failed: %v", err)
	}

	// 8. Execute post-build hooks
	if cfg.UpdateContentCommand != nil && len(*cfg.UpdateContentCommand) > 0 {
		if err := executor.ExecuteHook("postbuild", []string(*cfg.UpdateContentCommand)); err != nil {
			log.Printf("Warning: Post-build hooks failed: %v", err)
		}
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
	buildCmd.Flags().StringVar(&registryMirror, "registry-mirror", "", "Docker registry mirror URL (e.g., https://registry.docker-cn.com)")
	buildCmd.Flags().StringVar(&baseImage, "base-image", "", "Override base image in Dockerfile (e.g., registry.cn-hangzhou.aliyuncs.com/acs/ubuntu:22.04)")
}

var rootCmd = &cobra.Command{
	Use:   "envbuilder",
	Short: "Build devcontainer images without Docker",
}

func main() {
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}
