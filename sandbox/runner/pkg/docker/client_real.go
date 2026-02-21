package docker

import (
	"archive/tar"
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"time"

	"github.com/docker/docker/api/types"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/client"
	nat "github.com/docker/go-connections/nat"
)

// RealClient is a real Docker client implementation
type RealClient struct {
	cli        *client.Client
	dockerHost string
}

// NewRealClient creates a new real Docker client
func NewRealClient(dockerHost string) (*RealClient, error) {
	cli, err := client.NewClientWithOpts(
		client.WithHost(dockerHost),
		client.WithAPIVersionNegotiation(),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create Docker client: %w", err)
	}

	return &RealClient{
		cli:        cli,
		dockerHost: dockerHost,
	}, nil
}

// CreateContainer creates a Docker container
func (r *RealClient) CreateContainer(ctx context.Context, config *ContainerConfig) (string, error) {
	log.Printf("DEBUG: Creating container with ExtraHosts: %v", config.ExtraHosts)

	hostConfig := &container.HostConfig{
		NetworkMode: container.NetworkMode(config.NetworkMode),
	}

	// Add extra hosts if specified
	if len(config.ExtraHosts) > 0 {
		hostConfig.ExtraHosts = config.ExtraHosts
		log.Printf("DEBUG: Added ExtraHosts to hostConfig: %v", hostConfig.ExtraHosts)
	}

	// Set resource limits if specified
	if config.Memory > 0 || config.CPUPeriod > 0 || config.CPUShares > 0 {
		hostConfig.Resources = container.Resources{
			Memory:     config.Memory,
			CPUPeriod:  config.CPUPeriod,
			CPUShares:  config.CPUShares,
		}
	}

	// Set up port bindings if specified
	var exposedPorts nat.PortSet
	if len(config.Ports) > 0 {
		exposedPorts = make(nat.PortSet)
		portBindings := make(nat.PortMap)
		for _, port := range config.Ports {
			containerPort := nat.Port(fmt.Sprintf("%d/%s", port.ContainerPort, port.Protocol))
			exposedPorts[containerPort] = struct{}{}
			hostPort := ""
			if port.HostPort > 0 {
				hostPort = fmt.Sprintf("%d", port.HostPort)
			}
			portBindings[containerPort] = []nat.PortBinding{
				{HostPort: hostPort},
			}
		}
		hostConfig.PortBindings = portBindings
	}

	containerConfig := &container.Config{
		Image:        config.Image,
		Env:          config.Env,
		Cmd:          config.Cmd,
		Entrypoint:   config.Entrypoint,
		Labels:       config.Labels,
		ExposedPorts: exposedPorts,
	}

	resp, err := r.cli.ContainerCreate(ctx, containerConfig, hostConfig, nil, nil, config.Name)
	if err != nil {
		return "", fmt.Errorf("failed to create container: %w", err)
	}

	return resp.ID, nil
}

// StartContainer starts a Docker container
func (r *RealClient) StartContainer(ctx context.Context, containerID string) error {
	return r.cli.ContainerStart(ctx, containerID, types.ContainerStartOptions{})
}

// StopContainer stops a Docker container
func (r *RealClient) StopContainer(ctx context.Context, containerID string, timeout int) error {
	return r.cli.ContainerStop(ctx, containerID, container.StopOptions{
		Timeout: &timeout,
	})
}

// RemoveContainer removes a Docker container
func (r *RealClient) RemoveContainer(ctx context.Context, containerID string, force bool) error {
	return r.cli.ContainerRemove(ctx, containerID, types.ContainerRemoveOptions{
		Force: force,
	})
}

// ListContainers lists all containers
func (r *RealClient) ListContainers(ctx context.Context, all bool) ([]ContainerInfo, error) {
	containers, err := r.cli.ContainerList(ctx, types.ContainerListOptions{All: all})
	if err != nil {
		return nil, fmt.Errorf("failed to list containers: %w", err)
	}

	var result []ContainerInfo
	for _, c := range containers {
		// Inspect container to get port bindings
		var ports []PortBinding
		info, err := r.cli.ContainerInspect(ctx, c.ID)
		if err == nil {
			// Extract port bindings from NetworkSettings
			for containerPort, bindings := range info.NetworkSettings.Ports {
				portStr := string(containerPort)
				var containerPortNum int
				var protocol string
				fmt.Sscanf(portStr, "%d/%s", &containerPortNum, &protocol)
				for _, binding := range bindings {
					var hostPort int
					fmt.Sscanf(binding.HostPort, "%d", &hostPort)
					ports = append(ports, PortBinding{
						ContainerPort: containerPortNum,
						HostPort:      hostPort,
						Protocol:      protocol,
					})
				}
			}
		}

		result = append(result, ContainerInfo{
			ID:        c.ID,
			Image:     c.Image,
			Names:     c.Names,
			State:     c.State,
			Status:    c.Status,
			Ports:     ports,
			Labels:    c.Labels,
			CreatedAt: time.Unix(c.Created, 0).Format(time.RFC3339),
		})
	}

	return result, nil
}

// ContainerStatus returns container status
func (r *RealClient) ContainerStatus(ctx context.Context, containerID string) (string, error) {
	info, err := r.cli.ContainerInspect(ctx, containerID)
	if err != nil {
		return "", err
	}
	return info.State.Status, nil
}

// PullImage pulls a Docker image
func (r *RealClient) PullImage(ctx context.Context, image string, auth *AuthConfig) error {
	log.Printf("Pulling Docker image: %s", image)

	// Check if image already exists
	exists, err := r.ImageExists(ctx, image)
	if err != nil {
		return fmt.Errorf("failed to check if image exists: %w", err)
	}
	if exists {
		log.Printf("Image %s already exists", image)
		return nil
	}

	// Pull the image
	pullResp, err := r.cli.ImagePull(ctx, image, types.ImagePullOptions{})
	if err != nil {
		return fmt.Errorf("failed to start image pull: %w", err)
	}
	defer pullResp.Close()

	// Wait for pull to complete
	_, err = io.ReadAll(pullResp)
	if err != nil {
		return fmt.Errorf("failed to pull image: %w", err)
	}

	log.Printf("Successfully pulled image: %s", image)
	return nil
}

// ImageExists checks if image exists
func (r *RealClient) ImageExists(ctx context.Context, image string) (bool, error) {
	_, _, err := r.cli.ImageInspectWithRaw(ctx, image)
	if err != nil {
		if client.IsErrNotFound(err) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// CreateNetwork creates a network
func (r *RealClient) CreateNetwork(ctx context.Context, name string) (string, error) {
	resp, err := r.cli.NetworkCreate(ctx, name, types.NetworkCreate{
		Driver: "bridge",
	})
	if err != nil {
		return "", fmt.Errorf("failed to create network: %w", err)
	}
	return resp.ID, nil
}

// RemoveNetwork removes a network
func (r *RealClient) RemoveNetwork(ctx context.Context, networkID string) error {
	return r.cli.NetworkRemove(ctx, networkID)
}

// ContainerLogs returns container logs
func (r *RealClient) ContainerLogs(ctx context.Context, containerID string, follow bool) (io.ReadCloser, error) {
	logs, err := r.cli.ContainerLogs(ctx, containerID, types.ContainerLogsOptions{
		Follow:     follow,
		ShowStdout: true,
		ShowStderr: true,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get logs: %w", err)
	}
	return logs, nil
}

// CopyFileToContainer copies a file to the container
func (r *RealClient) CopyFileToContainer(ctx context.Context, containerID, destPath string, content io.Reader) error {
	// Read all content from the reader
	data, err := io.ReadAll(content)
	if err != nil {
		return fmt.Errorf("failed to read content: %w", err)
	}

	// Create a tar archive with the file
	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)

	// Get file info (use default permissions)
	hdr := &tar.Header{
		Name:     destPath,
		Mode:     0755,
		Size:     int64(len(data)),
		Typeflag: tar.TypeReg,
	}

	if err := tw.WriteHeader(hdr); err != nil {
		return fmt.Errorf("failed to write tar header: %w", err)
	}
	if _, err := tw.Write(data); err != nil {
		return fmt.Errorf("failed to write tar content: %w", err)
	}
	if err := tw.Close(); err != nil {
		return fmt.Errorf("failed to close tar writer: %w", err)
	}

	// Copy to container
	err = r.cli.CopyToContainer(ctx, containerID, "/", &buf, types.CopyToContainerOptions{
		AllowOverwriteDirWithFile: true,
	})
	if err != nil {
		return fmt.Errorf("failed to copy file to container: %w", err)
	}
	return nil
}
