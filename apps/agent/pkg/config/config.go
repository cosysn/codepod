package config

import (
	"fmt"
	"os"
)

// Config represents the Agent configuration
type Config struct {
	Agent AgentConfig
	SSH   SSHConfig
}

// AgentConfig holds Agent connection settings
type AgentConfig struct {
	Token       string
	ServerURL   string
	SandboxID   string
}

// SSHConfig holds SSH server settings
type SSHConfig struct {
	Port        int
	HostKeys    []string
	MaxSessions int
	IdleTimeout int
}

func Load() (*Config, error) {
	return &Config{
		Agent: AgentConfig{
			Token:     os.Getenv("AGENT_TOKEN"),
			ServerURL: os.Getenv("AGENT_SERVER_URL"),
			SandboxID: os.Getenv("AGENT_SANDBOX_ID"),
		},
		SSH: SSHConfig{
			Port:        22,
			HostKeys:    []string{"/etc/ssh/ssh_host_rsa_key"},
			MaxSessions: 10,
			IdleTimeout: 1800,
		},
	}, nil
}

func (c *Config) Validate() error {
	if c.Agent.SandboxID == "" {
		return fmt.Errorf("sandbox ID is required")
	}
	if c.Agent.Token == "" {
		return fmt.Errorf("agent token is required")
	}
	if c.Agent.ServerURL == "" {
		return fmt.Errorf("agent server URL is required")
	}
	return nil
}
