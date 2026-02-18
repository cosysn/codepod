package runner

import (
	"fmt"
	"log"
	"time"

	"github.com/codepod/codepod/apps/runner/pkg/config"
	"github.com/codepod/codepod/apps/runner/pkg/docker"
	"github.com/codepod/codepod/apps/runner/pkg/sandbox"
)

type Runner struct {
	cfg      *config.Config
	docker   docker.Client
	sandbox  *sandbox.Manager
	stopChan chan struct{}
}

func New() (*Runner, error) {
	cfg := config.LoadFromEnv()

	// Create Docker client
	dockerClient, err := docker.NewClient(cfg.Docker.Host)
	if err != nil {
		return nil, fmt.Errorf("failed to create Docker client: %w", err)
	}

	manager := sandbox.NewManager(dockerClient)

	log.Printf("Runner configured with server: %s", cfg.Server.URL)

	return &Runner{
		cfg:      cfg,
		docker:   dockerClient,
		sandbox:  manager,
		stopChan: make(chan struct{}),
	}, nil
}

func (r *Runner) Run() {
	log.Println("Runner is running...")

	// Keep alive ticker
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			log.Printf("Runner is healthy, waiting for jobs...")
		case <-r.stopChan:
			log.Println("Runner shutting down...")
			return
		}
	}
}

func (r *Runner) Stop() {
	log.Println("Stopping runner...")
	close(r.stopChan)
}

func (r *Runner) HealthCheck() error {
	// TODO: Implement health check
	return nil
}

// GetConfig returns the current configuration
func (r *Runner) GetConfig() *config.Config {
	return r.cfg
}

// GetID returns the runner ID
func (r *Runner) GetID() string {
	return r.cfg.Runner.ID
}

// GetMaxJobs returns the maximum number of concurrent jobs
func (r *Runner) GetMaxJobs() int {
	return r.cfg.Runner.MaxJobs
}
