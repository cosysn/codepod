package docker

import (
	"context"
	"fmt"
	"io"
	"sync"
	"time"
)

// MockClient is a mock Docker client for testing
type MockClient struct {
	mu          sync.RWMutex
	containers  map[string]*mockContainer
	images     map[string]bool
	networks   map[string]string
	nextID     int
}

// mockContainer represents a mock container
type mockContainer struct {
	config     *ContainerConfig
	id         string
	name       string
	state      ContainerState
	exitCode   int
	createdAt  time.Time
	startedAt  time.Time
}

// NewMockClient creates a new mock Docker client
func NewMockClient() *MockClient {
	return &MockClient{
		containers: make(map[string]*mockContainer),
		images:     make(map[string]bool),
		networks:   make(map[string]string),
		nextID:     1,
	}
}

// CreateContainer creates a mock container
func (m *MockClient) CreateContainer(ctx context.Context, config *ContainerConfig) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	id := fmt.Sprintf("container-%d", m.nextID)
	m.nextID++

	m.containers[id] = &mockContainer{
		config:    config,
		id:        id,
		name:      config.Name,
		state:     ContainerStateCreated,
		createdAt: time.Now(),
	}

	return id, nil
}

// StartContainer starts a mock container
func (m *MockClient) StartContainer(ctx context.Context, containerID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	c, ok := m.containers[containerID]
	if !ok {
		return &Error{Code: "NOT_FOUND", Message: "Container not found"}
	}

	c.state = ContainerStateRunning
	c.startedAt = time.Now()
	return nil
}

// StopContainer stops a mock container
func (m *MockClient) StopContainer(ctx context.Context, containerID string, timeout int) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	c, ok := m.containers[containerID]
	if !ok {
		return &Error{Code: "NOT_FOUND", Message: "Container not found"}
	}

	c.state = ContainerStateExited
	return nil
}

// RemoveContainer removes a mock container
func (m *MockClient) RemoveContainer(ctx context.Context, containerID string, force bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	c, ok := m.containers[containerID]
	if !ok {
		return &Error{Code: "NOT_FOUND", Message: "Container not found"}
	}

	if c.state == ContainerStateRunning && !force {
		return &Error{Code: "BUSY", Message: "Container is running"}
	}

	delete(m.containers, containerID)
	return nil
}

// ListContainers lists mock containers
func (m *MockClient) ListContainers(ctx context.Context, all bool) ([]ContainerInfo, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var result []ContainerInfo
	for _, c := range m.containers {
		if all || c.state == ContainerStateRunning {
			info := ContainerInfo{
				ID:        c.id,
				Image:     c.config.Image,
				Names:     []string{"/" + c.name},
				State:     string(c.state),
				Status:    string(c.state),
				Labels:    c.config.Labels,
				CreatedAt: c.createdAt.Format(time.RFC3339),
			}
			result = append(result, info)
		}
	}

	return result, nil
}

// ContainerStatus returns the status of a mock container
func (m *MockClient) ContainerStatus(ctx context.Context, containerID string) (string, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	c, ok := m.containers[containerID]
	if !ok {
		return "", &Error{Code: "NOT_FOUND", Message: "Container not found"}
	}

	return string(c.state), nil
}

// PullImage simulates pulling a mock image
func (m *MockClient) PullImage(ctx context.Context, image string, auth *AuthConfig) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.images[image] = true
	return nil
}

// ImageExists checks if a mock image exists
func (m *MockClient) ImageExists(ctx context.Context, image string) (bool, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	return m.images[image], nil
}

// CreateNetwork creates a mock network
func (m *MockClient) CreateNetwork(ctx context.Context, name string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	id := fmt.Sprintf("network-%d", m.nextID)
	m.nextID++
	m.networks[name] = id

	return id, nil
}

// RemoveNetwork removes a mock network
func (m *MockClient) RemoveNetwork(ctx context.Context, networkID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	for name, id := range m.networks {
		if id == networkID {
			delete(m.networks, name)
			break
		}
	}

	return nil
}

// ContainerLogs returns mock container logs
func (m *MockClient) ContainerLogs(ctx context.Context, containerID string, follow bool) (io.ReadCloser, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	c, ok := m.containers[containerID]
	if !ok {
		return nil, &Error{Code: "NOT_FOUND", Message: "Container not found"}
	}

	// Return a simple mock reader
	r := &mockReader{content: []byte("Mock logs for " + c.name)}
	return r, nil
}

// CopyFileToContainer copies a file to the container
func (m *MockClient) CopyFileToContainer(ctx context.Context, containerID, destPath string, content io.Reader) error {
	m.mu.RLock()
	defer m.mu.RUnlock()

	_, ok := m.containers[containerID]
	if !ok {
		return &Error{Code: "NOT_FOUND", Message: "Container not found"}
	}

	return nil
}

// mockReader is a simple io.ReadCloser for mock logs
type mockReader struct {
	content []byte
	pos     int
}

func (r *mockReader) Read(p []byte) (n int, err error) {
	if r.pos >= len(r.content) {
		return 0, io.EOF
	}
	n = copy(p, r.content[r.pos:])
	r.pos += n
	return n, nil
}

func (r *mockReader) Close() error {
	return nil
}

// GetContainer returns a mock container by ID (for testing)
func (m *MockClient) GetContainer(id string) *mockContainer {
	m.mu.RLock()
	defer m.mu.RUnlock()

	return m.containers[id]
}

// SetContainerState sets the state of a mock container (for testing)
func (m *MockClient) SetContainerState(id string, state ContainerState) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if c, ok := m.containers[id]; ok {
		c.state = state
	}
}
