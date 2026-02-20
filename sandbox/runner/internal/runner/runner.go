package runner

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"strings"
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
	client   *GrpcClient
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
		return nil, fmt.Errorf("failed to create client: %w", err)
	}

	return &Runner{
		cfg:      cfg,
		docker:   dockerClient,
		sandbox:  manager,
		client:   grpcClient,
		stopChan: make(chan struct{}),
	}, nil
}

func (r *Runner) Run() {
	log.Println("Runner is running...")

	// Register with server
	if err := r.client.Register(context.Background()); err != nil {
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
	if r.client != nil {
		r.client.Close()
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

// GetClient returns the client
func (r *Runner) GetClient() *GrpcClient {
	return r.client
}

// getHost returns the host address for SSH connections
// Uses configured host if set, otherwise defaults to localhost
func (r *Runner) getHost() string {
	if r.cfg.Runner.Host != "" {
		return r.cfg.Runner.Host
	}
	return "localhost"
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
			jobs, err := r.client.PollJobs(ctx)
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
	if err := r.client.AcceptJob(ctx, job.ID); err != nil {
		log.Printf("Failed to accept job %s: %v", job.ID, err)
		// Try to complete with failure
		r.client.CompleteJob(ctx, job.ID, false, fmt.Sprintf("Failed to accept: %v", err))
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
		r.client.CompleteJob(ctx, job.ID, false, err.Error())
		return err
	}
}

// handleCreateJob handles a create sandbox job
func (r *Runner) handleCreateJob(ctx context.Context, job *Job) error {
	log.Printf("Creating sandbox %s with image %s", job.SandboxID, job.Image)

	// Check if sandbox already exists
	existingSandbox, err := r.sandbox.GetByName(ctx, job.SandboxID)
	if err == nil && existingSandbox != nil {
		log.Printf("Sandbox %s already exists (container: %s), checking status...", job.SandboxID, existingSandbox.ContainerID)

		// Check if it's already running
		status, err := r.sandbox.GetStatus(ctx, existingSandbox)
		if err == nil && status == sandbox.SandboxStatusRunning {
			log.Printf("Sandbox %s is already running", job.SandboxID)

			// Report status: running
			if err := r.client.UpdateSandboxStatus(ctx, job.SandboxID, &SandboxStatusUpdate{
				Status:      "running",
				ContainerID: existingSandbox.ContainerID,
				Port:        existingSandbox.Port,
				Host:        r.getHost(),
				Message:     "Sandbox already running",
			}); err != nil {
				log.Printf("Warning: failed to report running status: %v", err)
			}

			// Complete the job successfully
			r.client.CompleteJob(ctx, job.ID, true, "Sandbox already running")
			return nil
		}

		// Sandbox exists but not running, try to start it
		log.Printf("Sandbox %s exists but not running, starting...", job.SandboxID)
		if err := r.sandbox.Start(ctx, existingSandbox); err != nil {
			log.Printf("Failed to start existing sandbox %s: %v", job.SandboxID, err)
			// Continue to recreate
		} else {
			// Report status: running
			if err := r.client.UpdateSandboxStatus(ctx, job.SandboxID, &SandboxStatusUpdate{
				Status:      "running",
				ContainerID: existingSandbox.ContainerID,
				Port:        existingSandbox.Port,
				Host:        r.getHost(),
				Message:     "Sandbox started",
			}); err != nil {
				log.Printf("Warning: failed to report running status: %v", err)
			}
			r.client.CompleteJob(ctx, job.ID, true, "Sandbox started")
			return nil
		}

		// Delete the existing sandbox and recreate
		log.Printf("Deleting existing sandbox %s for recreation", job.SandboxID)
		if err := r.sandbox.Delete(ctx, existingSandbox); err != nil {
			log.Printf("Warning: failed to delete existing sandbox: %v", err)
		}
	}

	// Report status: creating
	if err := r.client.UpdateSandboxStatus(ctx, job.SandboxID, &SandboxStatusUpdate{
		Status:  "creating",
		Message: "Creating container",
	}); err != nil {
		log.Printf("Warning: failed to report creating status: %v", err)
	}

	// Use token from job if provided, otherwise generate one
	agentToken := job.Token
	if agentToken == "" {
		agentToken = uuid.New().String()
	}

	// Fetch SSH CA public key from server for certificate authentication
	caPublicKey, err := r.client.GetSSHCAPublicKey(ctx)
	if err != nil {
		log.Printf("Warning: failed to fetch SSH CA public key: %v", err)
		// Continue without CA key - will fall back to token auth
	}

	// Build environment variables
	env := map[string]string{
		"AGENT_TOKEN":      agentToken,
		"AGENT_SANDBOX_ID": job.SandboxID,
		"AGENT_SERVER_URL": r.cfg.Server.URL,
	}

	// Add CA public key if available (base64 encoded to avoid newline issues in env vars)
	if caPublicKey != "" {
		env["AGENT_TRUSTED_USER_CA_KEYS"] = base64.StdEncoding.EncodeToString([]byte(caPublicKey))
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
		NetworkMode:     r.cfg.Docker.Network,
		AgentBinaryPath: r.cfg.Agent.BinaryPath,
		AgentToken:     agentToken,
		AgentServerURL:  r.cfg.Server.URL,
	}

	// Create sandbox
	sb, err := r.sandbox.Create(ctx, opts)
	if err != nil {
		log.Printf("Failed to create sandbox %s: %v", job.SandboxID, err)
		r.client.UpdateSandboxStatus(ctx, job.SandboxID, &SandboxStatusUpdate{
			Status:  "failed",
			Message: err.Error(),
		})
		r.client.CompleteJob(ctx, job.ID, false, fmt.Sprintf("Failed to create sandbox: %v", err))
		return err
	}

	// Report status: starting
	if err := r.client.UpdateSandboxStatus(ctx, job.SandboxID, &SandboxStatusUpdate{
		Status:      "starting",
		ContainerID: sb.ContainerID,
		Message:     "Starting container",
	}); err != nil {
		log.Printf("Warning: failed to report starting status: %v", err)
	}

	// Start sandbox
	if err := r.sandbox.Start(ctx, sb); err != nil {
		log.Printf("Failed to start sandbox %s: %v", job.SandboxID, err)
		r.client.UpdateSandboxStatus(ctx, job.SandboxID, &SandboxStatusUpdate{
			Status:  "failed",
			Message: err.Error(),
		})
		r.client.CompleteJob(ctx, job.ID, false, fmt.Sprintf("Failed to start sandbox: %v", err))
		return err
	}

	// Report status: running
	if err := r.client.UpdateSandboxStatus(ctx, job.SandboxID, &SandboxStatusUpdate{
		Status:      "running",
		ContainerID: sb.ContainerID,
		Port:        sb.Port,
		Host:        r.getHost(),
		Message:     "Sandbox running",
	}); err != nil {
		log.Printf("Warning: failed to report running status: %v", err)
	}

	// Complete the job successfully
	if err := r.client.CompleteJob(ctx, job.ID, true, "Sandbox created and started"); err != nil {
		log.Printf("Warning: failed to complete job: %v", err)
	}

	log.Printf("Sandbox %s created and started successfully (container: %s, port: %d)", job.SandboxID, sb.ContainerID, sb.Port)
	return nil
}

// handleDeleteJob handles a delete sandbox job
func (r *Runner) handleDeleteJob(ctx context.Context, job *Job) error {
	log.Printf("Deleting sandbox %s", job.SandboxID)

	// Report status: deleting
	if err := r.client.UpdateSandboxStatus(ctx, job.SandboxID, &SandboxStatusUpdate{
		Status:  "deleting",
		Message: "Deleting container",
	}); err != nil {
		log.Printf("Warning: failed to report deleting status: %v", err)
	}

	// Try to find the sandbox by name (not by container ID)
	sb, err := r.sandbox.GetByName(ctx, job.SandboxID)
	if err != nil {
		// Debug: list all containers to see what's available
		containers, listErr := r.sandbox.List(ctx)
		if listErr == nil {
			log.Printf("Available sandboxes:")
			for _, s := range containers {
				log.Printf("  - ID: %s, Name: %s, ContainerID: %s", s.ID, s.Name, s.ContainerID)
			}
		}

		// Sandbox not found - try to find by container ID prefix
		log.Printf("Sandbox %s not found by name, trying by label", job.SandboxID)
		for _, s := range containers {
			if strings.HasPrefix(s.ContainerID, job.SandboxID) || strings.Contains(job.SandboxID, s.ID) {
				log.Printf("Found matching sandbox by ID: %s", s.Name)
				sb = s
				err = nil
				break
			}
		}

		if err != nil {
			// Sandbox not found - may have already been deleted
			log.Printf("Sandbox %s not found, marking job as complete", job.SandboxID)
			r.client.CompleteJob(ctx, job.ID, true, "Sandbox not found (may already be deleted)")
			return nil
		}
	}

	// Stop the sandbox
	if err := r.sandbox.Stop(ctx, sb); err != nil {
		log.Printf("Failed to stop sandbox %s: %v", job.SandboxID, err)
		r.client.CompleteJob(ctx, job.ID, false, fmt.Sprintf("Failed to stop sandbox: %v", err))
		return err
	}

	// Delete the sandbox
	if err := r.sandbox.Delete(ctx, sb); err != nil {
		log.Printf("Failed to delete sandbox %s: %v", job.SandboxID, err)
		r.client.UpdateSandboxStatus(ctx, job.SandboxID, &SandboxStatusUpdate{
			Status:  "failed",
			Message: err.Error(),
		})
		r.client.CompleteJob(ctx, job.ID, false, fmt.Sprintf("Failed to delete sandbox: %v", err))
		return err
	}

	log.Printf("Sandbox %s deleted successfully", job.SandboxID)
	r.client.CompleteJob(ctx, job.ID, true, "Sandbox deleted successfully")
	return nil
}
