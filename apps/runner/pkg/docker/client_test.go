package docker

import (
	"testing"
)

func TestContainerConfig(t *testing.T) {
	config := &ContainerConfig{
		Image:      "python:3.11",
		Name:       "test-container",
		Env:        []string{"DEBUG=1", "TEST=value"},
		Volumes:    []VolumeMount{{Type: "volume", Source: "data", Target: "/data"}},
		Ports:      []PortBinding{{ContainerPort: 8080, HostPort: 8080, Protocol: "tcp"}},
		Entrypoint: []string{"/bin/sh"},
		Cmd:        []string{"-c", "echo hello"},
		Labels:     map[string]string{"app": "test"},
		Memory:     512 * 1024 * 1024,
		CPUPeriod:  100000,
		CPUShares:  512,
		PidsLimit:  100,
		ReadOnlyRoot: false,
		NetworkMode: "bridge",
	}

	if config.Image != "python:3.11" {
		t.Errorf("expected image python:3.11, got %s", config.Image)
	}
	if config.Name != "test-container" {
		t.Errorf("expected name test-container, got %s", config.Name)
	}
	if len(config.Env) != 2 {
		t.Errorf("expected 2 env vars, got %d", len(config.Env))
	}
	if len(config.Volumes) != 1 {
		t.Errorf("expected 1 volume, got %d", len(config.Volumes))
	}
	if config.Memory != 512*1024*1024 {
		t.Errorf("expected memory 512MB, got %d", config.Memory)
	}
}

func TestVolumeMount(t *testing.T) {
	tests := []struct {
		mount    VolumeMount
		expected string
	}{
		{VolumeMount{Type: "bind", Source: "/host", Target: "/container"}, "bind"},
		{VolumeMount{Type: "volume", Source: "myvolume", Target: "/data"}, "volume"},
		{VolumeMount{Type: "tmpfs", Target: "/tmp"}, "tmpfs"},
	}

	for _, tt := range tests {
		if tt.mount.Type != tt.expected {
			t.Errorf("expected type %s, got %s", tt.expected, tt.mount.Type)
		}
	}
}

func TestPortBinding(t *testing.T) {
	pb := PortBinding{
		ContainerPort: 80,
		HostPort:      8080,
		Protocol:      "tcp",
	}

	if pb.ContainerPort != 80 {
		t.Errorf("expected container port 80, got %d", pb.ContainerPort)
	}
	if pb.HostPort != 8080 {
		t.Errorf("expected host port 8080, got %d", pb.HostPort)
	}
	if pb.Protocol != "tcp" {
		t.Errorf("expected protocol tcp, got %s", pb.Protocol)
	}
}

func TestAuthConfig(t *testing.T) {
	auth := AuthConfig{
		Username: "user",
		Password: "pass",
		Registry: "docker.io",
	}

	if auth.Username != "user" {
		t.Errorf("expected username user, got %s", auth.Username)
	}
	if auth.Password != "pass" {
		t.Errorf("expected password pass, got %s", auth.Password)
	}
}

func TestContainerStateConstants(t *testing.T) {
	states := []struct {
		state   ContainerState
		values  []ContainerState
	}{
		{ContainerStateCreated, []ContainerState{"created", "running", "paused"}},
		{ContainerStateRunning, []ContainerState{"created", "running", "paused"}},
		{ContainerStatePaused, []ContainerState{"created", "running", "paused"}},
		{ContainerStateExited, []ContainerState{"exited", "dead"}},
	}

	for _, s := range states {
		found := false
		for _, v := range s.values {
			if s.state == v {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("state %s not found in expected values", s.state)
		}
	}
}

func TestError(t *testing.T) {
	err := &Error{
		Code:    "NOT_FOUND",
		Message: "Container not found",
	}

	if err.Error() != "NOT_FOUND: Container not found" {
		t.Errorf("unexpected error message: %s", err.Error())
	}
}

func TestIsNotFound(t *testing.T) {
	tests := []struct {
		err      error
		expected bool
	}{
		{nil, false},
		{&Error{Code: "NOT_FOUND", Message: "Container not found"}, true},
		{&Error{Code: "UNKNOWN", Message: "No such container"}, true},
		{&Error{Code: "BUSY", Message: "Container is running"}, false},
	}

	for _, tt := range tests {
		if IsNotFound(tt.err) != tt.expected {
			t.Errorf("IsNotFound(%v) = %v, expected %v", tt.err, IsNotFound(tt.err), tt.expected)
		}
	}
}

func TestContainerInfo(t *testing.T) {
	info := ContainerInfo{
		ID:        "abc123",
		Image:     "python:3.11",
		Names:     []string{"/test-container"},
		State:     "running",
		Status:    "Up 10 minutes",
		Ports:     []PortBinding{{ContainerPort: 80, HostPort: 8080}},
		CreatedAt: "2026-02-17T10:00:00.000000000Z",
	}

	if info.ID != "abc123" {
		t.Errorf("expected ID abc123, got %s", info.ID)
	}
	if info.Image != "python:3.11" {
		t.Errorf("expected image python:3.11, got %s", info.Image)
	}
	if info.State != "running" {
		t.Errorf("expected state running, got %s", info.State)
	}
	if len(info.Names) != 1 {
		t.Errorf("expected 1 name, got %d", len(info.Names))
	}
}
