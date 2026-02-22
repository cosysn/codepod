package main

import (
	"context"
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
	workspace       string
	imageName       string
	registryURL     string
	registryMirror  string
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

	// 2. Pre-pull base image if registry mirror is configured (only for kaniko to use local image)
	if registryMirror != "" && cfg.Image != nil && *cfg.Image != "" {
		log.Printf("Pre-pulling base image using mirror: %s -> %s", *cfg.Image, registryMirror)
		if err := builder.PrePullBaseImage(*cfg.Image, registryMirror); err != nil {
			log.Printf("Warning: Failed to pre-pull base image: %v", err)
		} else {
			log.Printf("Base image pulled successfully, kaniko will use local image")
		}
	}

	// 3. Execute pre-build hooks
	if registryMirror != "" && cfg.Image != nil && *cfg.Image != "" {
		log.Printf("Pre-pulling base image with mirror: %s", registryMirror)
		if err := builder.PrePullBaseImage(*cfg.Image, registryMirror); err != nil {
			log.Printf("Warning: Failed to pre-pull base image: %v", err)
		}
	}

	// 3. Execute pre-build hooks
	executor := hooks.NewExecutor(workspace)
	if cfg.OnCreateCommand != nil && len(*cfg.OnCreateCommand) > 0 {
		if err := executor.ExecuteHook("prebuild", []string(*cfg.OnCreateCommand)); err != nil {
			log.Printf("Warning: Pre-build hooks failed: %v", err)
		}
	}

	// 3. Resolve features
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

	// 4. Configure Docker registry mirror if provided
	if registryMirror != "" {
		log.Printf("Configuring registry mirror: %s", registryMirror)
		if err := builder.ConfigureRegistryMirror(registryMirror); err != nil {
			log.Printf("Warning: Failed to configure registry mirror: %v", err)
		}
	}

	// 5. Create kaniko builder
	kanikoBuilder := builder.NewKanikoBuilder(workspace, imageName)

	// Check for Dockerfile in config or default location
	dockerfilePath := ".devcontainer/Dockerfile"
	if cfg.DockerFile != nil {
		dockerfilePath = *cfg.DockerFile
	} else {
		// Check if Dockerfile exists at default location
		defaultDockerfile := fmt.Sprintf("%s/.devcontainer/Dockerfile", workspace)
		if _, err := os.Stat(defaultDockerfile); err == nil {
			dockerfilePath = defaultDockerfile
		}
	}
	kanikoBuilder.SetDockerfile(dockerfilePath)
	if featureScripts != nil && len(featureScripts) > 0 {
		kanikoBuilder.SetFeatureScripts(featureScripts)
	}

	// 6. Build image
	log.Println("Starting build...")
	if err := kanikoBuilder.Build(ctx); err != nil {
		log.Fatalf("Build failed: %v", err)
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
