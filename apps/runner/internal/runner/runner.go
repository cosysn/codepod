package runner

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/codepod/codepod/apps/runner/pkg/config"
	"github.com/codepod/codepod/apps/runner/pkg/docker"
	"github.com/codepod/codepod/apps/runner/pkg/sandbox"
	"github.com/google/uuid"
)

type Runner struct {
	cfg      *config.Config
	docker   docker.Client
	sandbox  *sandbox.Manager
	grpc     *GrpcClient
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

	// Create gRPC client
	grpcConfig := &GrpcClientConfig{
		ServerURL: cfg.Server.URL,
		RunnerID:  cfg.Runner.ID,
		Capacity:  cfg.Runner.MaxJobs,
	}

	grpcClient, err := NewGrpcClient(grpcConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create gRPC client: %w", err)
	}

	return &Runner{
		cfg:      cfg,
		docker:   dockerClient,
		sandbox:  manager,
		grpc:     grpcClient,
		stopChan: make(chan struct{}),
	}, nil
}

func (r *Runner) Run() {
	log.Println("Runner is running...")

	// Register with server
	if err := r.grpc.Register(context.Background()); err != nil {
		log.Printf("Warning: Failed to register with server: %v", err)
	}

	// Start job processing in a separate goroutine
	go r.processJobs(context.Background())

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
	if r.grpc != nil {
		r.grpc.Close()
	}
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

// GetGrpcClient returns the gRPC client
func (r *Runner) GetGrpcClient() *GrpcClient {
	return r.grpc
}

// processJobs polls for jobs and processes them
func (r *Runner) processJobs(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("Job polling stopped (context cancelled)")
			return
		case <-r.stopChan:
			log.Println("Job polling stopped (runner stopping)")
			return
		case <-ticker.C:
			jobs, err := r.grpc.PollJobs(ctx)
			if err != nil {
				log.Printf("Failed to poll jobs: %v", err)
				continue
			}

			if len(jobs) == 0 {
				continue
			}

			log.Printf("Received %d jobs", len(jobs))

			for _, job := range jobs {
				if err := r.handleJob(ctx, &job); err != nil {
					log.Printf("Failed to handle job %s: %v", job.ID, err)
				}
			}
		}
	}
}

// handleJob processes a single job
func (r *Runner) handleJob(ctx context.Context, job *Job) error {
	log.Printf("Processing job %s (type: %s, sandbox: %s)", job.ID, job.Type, job.SandboxID)

	// Accept the job
	if err := r.grpc.AcceptJob(ctx, job.ID); err != nil {
		log.Printf("Failed to accept job %s: %v", job.ID, err)
		// Try to complete with failure
		r.grpc.CompleteJob(ctx, job.ID, false, fmt.Sprintf("Failed to accept: %v", err))
		return err
	}

	// Execute based on job type
	switch job.Type {
	case "create":
		return r.handleCreateJob(ctx, job)
	case "delete":
		return r.handleDeleteJob(ctx, job)
	default:
		err := fmt.Errorf("unknown job type: %s", job.Type)
		log.Printf("Job %s: %v", job.ID, err)
		r.grpc.CompleteJob(ctx, job.ID, false, err.Error())
		return err
	}
}

// handleCreateJob handles a create sandbox job
func (r *Runner) handleCreateJob(ctx context.Context, job *Job) error {
	log.Printf("Creating sandbox %s with image %s", job.SandboxID, job.Image)

	// Generate agent token if not provided
	agentToken := r.cfg.Agent.Token
	if agentToken == "" {
		agentToken = uuid.New().String()
	}

	// Build environment variables
	env := map[string]string{
		"AGENT_TOKEN":      agentToken,
		"AGENT_SANDBOX_ID": job.SandboxID,
		"AGENT_SERVER_URL": r.cfg.Server.URL,
	}

	// Merge job-specific environment variables
	for k, v := range job.Env {
		env[k] = v
	}

	// Prepare create options
	opts := &sandbox.CreateOptions{
		Name:            job.SandboxID,
		Image:           job.Image,
		Env:             env,
		Memory:          job.Memory,
		CPU:             job.CPU,
		NetworkMode:     job.NetworkMode,
		AgentBinaryPath: r.cfg.Agent.BinaryPath,
		AgentToken:     agentToken,
		AgentServerURL:  r.cfg.Server.URL,
	}

	// Create sandbox
	sb, err := r.sandbox.Create(ctx, opts)
	if err != nil {
		log.Printf("Failed to create sandbox %s: %v", job.SandboxID, err)
		r.grpc.CompleteJob(ctx, job.ID, false, fmt.Sprintf("Failed to create sandbox: %v", err))
		return err
	}

	// Start sandbox
	if err := r.sandbox.Start(ctx, sb); err != nil {
		log.Printf("Failed to start sandbox %s: %v", job.SandboxID, err)
		r.grpc.CompleteJob(ctx, job.ID, false, fmt.Sprintf("Failed to start sandbox: %v", err))
		return err
	}

	log.Printf("Sandbox %s created and started successfully", job.SandboxID)
	r.grpc.CompleteJob(ctx, job.ID, true, "Sandbox created and started successfully")
	return nil
}

// handleDeleteJob handles a delete sandbox job
func (r *Runner) handleDeleteJob(ctx context.Context, job *Job) error {
	log.Printf("Deleting sandbox %s", job.SandboxID)

	// Try to find the sandbox
	sb, err := r.sandbox.Get(ctx, job.SandboxID)
	if err != nil {
		// Sandbox not found - may have already been deleted
		log.Printf("Sandbox %s not found, marking job as complete", job.SandboxID)
		r.grpc.CompleteJob(ctx, job.ID, true, "Sandbox not found (may already be deleted)")
		return nil
	}

	// Stop the sandbox
	if err := r.sandbox.Stop(ctx, sb); err != nil {
		log.Printf("Failed to stop sandbox %s: %v", job.SandboxID, err)
		r.grpc.CompleteJob(ctx, job.ID, false, fmt.Sprintf("Failed to stop sandbox: %v", err))
		return err
	}

	// Delete the sandbox
	if err := r.sandbox.Delete(ctx, sb); err != nil {
		log.Printf("Failed to delete sandbox %s: %v", job.SandboxID, err)
		r.grpc.CompleteJob(ctx, job.ID, false, fmt.Sprintf("Failed to delete sandbox: %v", err))
		return err
	}

	log.Printf("Sandbox %s deleted successfully", job.SandboxID)
	r.grpc.CompleteJob(ctx, job.ID, true, "Sandbox deleted successfully")
	return nil
}
