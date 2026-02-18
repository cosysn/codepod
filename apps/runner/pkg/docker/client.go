package docker

import (
	"context"
	"fmt"
	"io"
	"strings"
)

// Client is a minimal Docker client interface for MVP
type Client interface {
	// Container operations
	CreateContainer(ctx context.Context, config *ContainerConfig) (string, error)
	StartContainer(ctx context.Context, containerID string) error
	StopContainer(ctx context.Context, containerID string, timeout int) error
	RemoveContainer(ctx context.Context, containerID string, force bool) error
	ListContainers(ctx context.Context, all bool) ([]ContainerInfo, error)
	ContainerStatus(ctx context.Context, containerID string) (string, error)

	// Image operations
	PullImage(ctx context.Context, image string, auth *AuthConfig) error
	ImageExists(ctx context.Context, image string) (bool, error)

	// Network operations
	CreateNetwork(ctx context.Context, name string) (string, error)
	RemoveNetwork(ctx context.Context, networkID string) error

	// Logs
	ContainerLogs(ctx context.Context, containerID string, follow bool) (io.ReadCloser, error)
}

// ContainerConfig holds Docker container configuration
type ContainerConfig struct {
	Image        string
	Name         string
	Env          []string
	Volumes      []VolumeMount
	Ports        []PortBinding
	Entrypoint   []string
	Cmd          []string
	Labels       map[string]string
	Memory       int64
	CPUPeriod    int64
	CPUShares    int64
	PidsLimit    int64
	ReadOnlyRoot  bool
	NetworkMode  string
}

// VolumeMount represents a volume mount
type VolumeMount struct {
	Type     string // "bind", "volume", "tmpfs"
	Source   string
	Target   string
	ReadOnly bool
}

// PortBinding represents a port mapping
type PortBinding struct {
	ContainerPort int
	HostPort      int
	Protocol      string // "tcp", "udp"
}

// AuthConfig holds Docker registry authentication
type AuthConfig struct {
	Username string
	Password string
	Registry string
}

// ContainerInfo holds container information
type ContainerInfo struct {
	ID        string
	Image     string
	Names     []string
	State     string
	Status    string
	Ports     []PortBinding
	Labels    map[string]string
	CreatedAt string
}

// ContainerState represents container state
type ContainerState string

const (
	ContainerStateCreated  ContainerState = "created"
	ContainerStateRunning  ContainerState = "running"
	ContainerStatePaused   ContainerState = "paused"
	ContainerStateRestarting ContainerState = "restarting"
	ContainerStateRemoving ContainerState = "removing"
	ContainerStateExited   ContainerState = "exited"
	ContainerStateDead     ContainerState = "dead"
)

// Error represents a Docker error
type Error struct {
	Code    string
	Message string
}

func (e *Error) Error() string {
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

// IsNotFound checks if the error is "not found"
func IsNotFound(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "not found") ||
		strings.Contains(err.Error(), "No such container")
}

// IsRunning checks if the error indicates container is running
func IsRunning(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "is already running")
}

// NewClient creates a Docker client based on configuration
// If dockerHost is empty or "mock", returns a MockClient
func NewClient(dockerHost string) (Client, error) {
	if dockerHost == "" || dockerHost == "mock" {
		return NewMockClient(), nil
	}

	return NewRealClient(dockerHost)
}
