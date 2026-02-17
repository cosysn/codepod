package sandbox

import (
	"context"
	"fmt"
	"time"

	"github.com/codepod/codepod/apps/runner/pkg/docker"
)

// Manager manages sandbox containers
type Manager struct {
	docker docker.Client
}

// Sandbox represents a sandbox instance
type Sandbox struct {
	ID          string
	Name        string
	ContainerID string
	Image       string
	Status      SandboxStatus
	CreatedAt   time.Time
	StartedAt   time.Time
	Config      *Config
}

// SandboxStatus represents sandbox state
type SandboxStatus string

const (
	SandboxStatusPending   SandboxStatus = "pending"
	SandboxStatusRunning   SandboxStatus = "running"
	SandboxStatusStopped   SandboxStatus = "stopped"
	SandboxStatusFailed    SandboxStatus = "failed"
	SandboxStatusDeleting  SandboxStatus = "deleting"
)

// Config holds sandbox configuration
type Config struct {
	Image       string
	Name        string
	Env         []string
	Memory      int64
	CPU         int64
	NetworkMode string
	Labels      map[string]string
}

// CreateOptions holds options for creating a sandbox
type CreateOptions struct {
	Image   string
	Name    string
	Env     map[string]string
	Memory  string
	CPU     int
	Timeout time.Duration
}

// NewManager creates a new sandbox manager
func NewManager(dockerClient docker.Client) *Manager {
	return &Manager{
		docker: dockerClient,
	}
}

// Create creates a new sandbox
func (m *Manager) Create(ctx context.Context, opts *CreateOptions) (*Sandbox, error) {
	// Build environment variables
	env := []string{}
	for k, v := range opts.Env {
		env = append(env, fmt.Sprintf("%s=%s", k, v))
	}

	// Parse memory
	memory, err := parseMemory(opts.Memory)
	if err != nil {
		return nil, fmt.Errorf("invalid memory: %w", err)
	}

	config := &docker.ContainerConfig{
		Image:      opts.Image,
		Name:       opts.Name,
		Env:        env,
		Labels:     map[string]string{"codepod.sandbox": opts.Name},
		Memory:     memory,
		CPUPeriod:  100000,
		CPUShares:  int64(opts.CPU * 1024),
		NetworkMode: "bridge",
	}

	// Create container
	containerID, err := m.docker.CreateContainer(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("failed to create container: %w", err)
	}

	return &Sandbox{
		ID:          containerID,
		Name:        opts.Name,
		ContainerID: containerID,
		Image:       opts.Image,
		Status:      SandboxStatusPending,
		CreatedAt:   time.Now(),
		Config: &Config{
			Image:  opts.Image,
			Name:   opts.Name,
			Env:    env,
			Memory: memory,
			CPU:    int64(opts.CPU),
		},
	}, nil
}

// Start starts a sandbox
func (m *Manager) Start(ctx context.Context, sb *Sandbox) error {
	if err := m.docker.StartContainer(ctx, sb.ContainerID); err != nil {
		return fmt.Errorf("failed to start container: %w", err)
	}

	sb.Status = SandboxStatusRunning
	sb.StartedAt = time.Now()
	return nil
}

// Stop stops a sandbox
func (m *Manager) Stop(ctx context.Context, sb *Sandbox) error {
	if err := m.docker.StopContainer(ctx, sb.ContainerID, 10); err != nil {
		return fmt.Errorf("failed to stop container: %w", err)
	}

	sb.Status = SandboxStatusStopped
	return nil
}

// Delete deletes a sandbox
func (m *Manager) Delete(ctx context.Context, sb *Sandbox) error {
	sb.Status = SandboxStatusDeleting

	if err := m.docker.RemoveContainer(ctx, sb.ContainerID, true); err != nil {
		return fmt.Errorf("failed to remove container: %w", err)
	}

	sb.Status = SandboxStatusStopped
	return nil
}

// GetStatus returns the current status of a sandbox
func (m *Manager) GetStatus(ctx context.Context, sb *Sandbox) (SandboxStatus, error) {
	state, err := m.docker.ContainerStatus(ctx, sb.ContainerID)
	if err != nil {
		return SandboxStatusFailed, err
	}

	switch docker.ContainerState(state) {
	case docker.ContainerStateRunning:
		return SandboxStatusRunning, nil
	case docker.ContainerStateCreated, docker.ContainerStatePaused:
		return SandboxStatusPending, nil
	case docker.ContainerStateExited, docker.ContainerStateDead:
		return SandboxStatusStopped, nil
	default:
		return SandboxStatusFailed, nil
	}
}

// List lists all sandboxes
func (m *Manager) List(ctx context.Context) ([]*Sandbox, error) {
	containers, err := m.docker.ListContainers(ctx, true)
	if err != nil {
		return nil, fmt.Errorf("failed to list containers: %w", err)
	}

	var sandboxes []*Sandbox
	for _, c := range containers {
		// Only include containers with our label
		if _, ok := c.Labels["codepod.sandbox"]; ok {
			sb := &Sandbox{
				ID:          c.ID,
				Name:        c.Names[0],
				ContainerID: c.ID,
				Image:       c.Image,
				Status:      SandboxStatus(c.State),
			}
			sandboxes = append(sandboxes, sb)
		}
	}

	return sandboxes, nil
}

// Get gets a sandbox by ID
func (m *Manager) Get(ctx context.Context, id string) (*Sandbox, error) {
	containers, err := m.docker.ListContainers(ctx, true)
	if err != nil {
		return nil, err
	}

	for _, c := range containers {
		if c.ID == id {
			return &Sandbox{
				ID:          c.ID,
				Name:        c.Names[0],
				ContainerID: c.ID,
				Image:       c.Image,
				Status:      SandboxStatus(c.State),
			}, nil
		}
	}

	return nil, fmt.Errorf("sandbox not found: %s", id)
}

// parseMemory parses memory string to bytes
func parseMemory(mem string) (int64, error) {
	if mem == "" {
		return 512 * 1024 * 1024, nil // Default 512MB
	}

	var multiplier int64 = 1
	switch {
	case len(mem) >= 2 && mem[len(mem)-2:] == "Mi":
		multiplier = 1024 * 1024
	case len(mem) >= 2 && mem[len(mem)-2:] == "Gi":
		multiplier = 1024 * 1024 * 1024
	case len(mem) >= 1 && mem[len(mem)-1:] == "M":
		multiplier = 1024 * 1024
	case len(mem) >= 1 && mem[len(mem)-1:] == "G":
		multiplier = 1024 * 1024 * 1024
	case len(mem) >= 2 && mem[len(mem)-2:] == "KB":
		multiplier = 1024
	case len(mem) >= 2 && mem[len(mem)-2:] == "GB":
		multiplier = 1024 * 1024 * 1024
	}

	// Extract numeric part
	numPart := mem
	for len(numPart) > 0 {
		c := numPart[len(numPart)-1]
		if c < '0' || c > '9' {
			break
		}
		numPart = numPart[:len(numPart)-1]
	}

	var value int64
	if numPart != mem {
		fmt.Sscanf(numPart, "%d", &value)
	}

	return value * multiplier, nil
}
