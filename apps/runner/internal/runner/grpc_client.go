package runner

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

// Job represents a job from the server
type Job struct {
	ID          string            `json:"id"`
	Type        string            `json:"type"`
	SandboxID   string            `json:"sandboxId"`
	Image       string            `json:"image"`
	Status      string            `json:"status"`
	RunnerID    string            `json:"runnerId,omitempty"`
	Env         map[string]string `json:"env,omitempty"`
	Memory      string            `json:"memory,omitempty"`
	CPU         int               `json:"cpu,omitempty"`
	NetworkMode string            `json:"networkMode,omitempty"`
}

// GrpcClientConfig holds the configuration for the gRPC client
type GrpcClientConfig struct {
	ServerURL string
	RunnerID  string
	Capacity  int
}

// GrpcClient manages the connection to the server (HTTP-based)
type GrpcClient struct {
	config *GrpcClientConfig
}

// NewGrpcClient creates a new client connection to the server
func NewGrpcClient(config *GrpcClientConfig) (*GrpcClient, error) {
	// Validate server URL
	if config.ServerURL == "" {
		return nil, fmt.Errorf("server URL is required")
	}

	return &GrpcClient{
		config: config,
	}, nil
}

// Close closes the client connection (no-op for HTTP)
func (c *GrpcClient) Close() error {
	return nil
}

// GetConfig returns the client configuration
func (c *GrpcClient) GetConfig() *GrpcClientConfig {
	return c.config
}

// Register registers the runner with the server via HTTP
func (c *GrpcClient) Register(ctx context.Context) error {
	// Register via HTTP for now
	url := fmt.Sprintf("%s/api/v1/runners/register", c.config.ServerURL)

	// Use HTTP client
	body := fmt.Sprintf(`{"id":"%s","capacity":%d}`, c.config.RunnerID, c.config.Capacity)
	req, err := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("registration failed: %d", resp.StatusCode)
	}

	fmt.Printf("Runner %s registered successfully\n", c.config.RunnerID)
	return nil
}

// PollJobs polls the server for pending jobs
func (c *GrpcClient) PollJobs(ctx context.Context) ([]Job, error) {
	// Build URL - remove trailing slash if present
	serverURL := strings.TrimRight(c.config.ServerURL, "/")
	url := fmt.Sprintf("%s/api/v1/jobs", serverURL)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Runner-Id", c.config.RunnerID)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("poll failed: %d", resp.StatusCode)
	}

	var result struct {
		Jobs []Job `json:"jobs"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	return result.Jobs, nil
}

// AcceptJob accepts a job for processing
func (c *GrpcClient) AcceptJob(ctx context.Context, jobID string) error {
	// Build URL - remove trailing slash if present
	serverURL := strings.TrimRight(c.config.ServerURL, "/")
	url := fmt.Sprintf("%s/api/v1/jobs/%s/accept", serverURL, jobID)

	req, err := http.NewRequestWithContext(ctx, "POST", url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("X-Runner-Id", c.config.RunnerID)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("accept failed: %d", resp.StatusCode)
	}

	return nil
}

// CompleteJob marks a job as completed
func (c *GrpcClient) CompleteJob(ctx context.Context, jobID string, success bool, message string) error {
	// Build URL - remove trailing slash if present
	serverURL := strings.TrimRight(c.config.ServerURL, "/")
	url := fmt.Sprintf("%s/api/v1/jobs/%s/complete", serverURL, jobID)

	body := fmt.Sprintf(`{"success":%v,"message":"%s"}`, success, message)
	req, err := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("X-Runner-Id", c.config.RunnerID)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("complete failed: %d", resp.StatusCode)
	}

	return nil
}

// DeleteJob deletes a sandbox (delete job)
func (c *GrpcClient) DeleteJob(ctx context.Context, job *Job) error {
	// Build URL - remove trailing slash if present
	serverURL := strings.TrimRight(c.config.ServerURL, "/")
	url := fmt.Sprintf("%s/api/v1/jobs/%s", serverURL, job.ID)

	req, err := http.NewRequestWithContext(ctx, "DELETE", url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("X-Runner-Id", c.config.RunnerID)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	// Accept and complete the job in one go for delete operations
	if resp.StatusCode == 200 || resp.StatusCode == 204 {
		return nil
	}

	return fmt.Errorf("delete job failed: %d", resp.StatusCode)
}

// SandboxStatusUpdate represents a status update request
type SandboxStatusUpdate struct {
	Status      string `json:"status"`
	ContainerID string `json:"containerId,omitempty"`
	Message     string `json:"message,omitempty"`
}

// UpdateSandboxStatus sends a status update to the server
func (c *GrpcClient) UpdateSandboxStatus(ctx context.Context, sandboxID string, update *SandboxStatusUpdate) error {
	// Build URL - remove trailing slash if present
	serverURL := strings.TrimRight(c.config.ServerURL, "/")
	url := fmt.Sprintf("%s/api/v1/sandboxes/%s/runner-status", serverURL, sandboxID)

	data, err := json.Marshal(update)
	if err != nil {
		return fmt.Errorf("failed to marshal status update: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Runner-Id", c.config.RunnerID)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send status update: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("server returned status %d", resp.StatusCode)
	}

	return nil
}
