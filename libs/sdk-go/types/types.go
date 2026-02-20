package types

import "time"

// SandboxStatus represents the status of a sandbox
type SandboxStatus string

const (
	SandboxStatusPending  SandboxStatus = "pending"
	SandboxStatusRunning SandboxStatus = "running"
	SandboxStatusStopped SandboxStatus = "stopped"
	SandboxStatusFailed  SandboxStatus = "failed"
	SandboxStatusDeleted SandboxStatus = "deleted"
)

// Sandbox represents a sandbox instance
type Sandbox struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Status    SandboxStatus `json:"status"`
	Image     string         `json:"image"`
	Host      string         `json:"host"`
	Port      int            `json:"port"`
	User      string         `json:"user"`
	Token     string         `json:"token,omitempty"`
	CreatedAt time.Time     `json:"created_at"`
	ExpiresAt time.Time     `json:"expires_at,omitempty"`
}

// CreateSandboxRequest represents a request to create a sandbox
type CreateSandboxRequest struct {
	Name     string            `json:"name,omitempty"`
	Image    string           `json:"image"`
	CPU      int              `json:"cpu,omitempty"`
	Memory   string           `json:"memory,omitempty"`
	Env      map[string]string `json:"env,omitempty"`
	Timeout  time.Duration    `json:"timeout,omitempty"`
}

// CreateSandboxResponse represents the response after creating a sandbox
type CreateSandboxResponse struct {
	Sandbox  *Sandbox `json:"sandbox"`
	SSHHost  string   `json:"ssh_host"`
	SSHPort  int      `json:"ssh_port"`
	SSHUser  string   `json:"ssh_user"`
	Token    string   `json:"token"`
}

// SandboxInfo represents detailed sandbox information
type SandboxInfo struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Status      SandboxStatus     `json:"status"`
	Image       string           `json:"image"`
	ContainerID string           `json:"container_id,omitempty"`
	Host        string           `json:"host"`
	Port        int              `json:"port"`
	Resources   *Resources       `json:"resources,omitempty"`
	CreatedAt   time.Time       `json:"created_at"`
	StartedAt   time.Time       `json:"started_at,omitempty"`
	ExpiresAt   time.Time       `json:"expires_at,omitempty"`
}

// Resources represents resource allocation
type Resources struct {
	CPU    int    `json:"cpu"`
	Memory string `json:"memory"`
	Disk   string `json:"disk,omitempty"`
}

// ErrorResponse represents an API error
type ErrorResponse struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Details string `json:"details,omitempty"`
}
