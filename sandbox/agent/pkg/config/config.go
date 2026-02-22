package config

import (
	"encoding/base64"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
)

// Config represents the Agent configuration
type Config struct {
	Agent AgentConfig
	SSH   SSHConfig
	GRPC  GRPCConfig
}

// AgentConfig holds Agent connection settings
type AgentConfig struct {
	Token       string
	ServerURL   string
	SandboxID   string
}

// SSHConfig holds SSH server settings
type SSHConfig struct {
	Port             int
	HostKeys         []string
	MaxSessions      int
	IdleTimeout      int
	TrustedUserCAKeys string // SSH CA public key for certificate authentication
}

// GRPCConfig holds gRPC server settings
type GRPCConfig struct {
	Port int
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
		GRPC: GRPCConfig{
			Port: getEnvIntOrDefault("AGENT_GRPC_PORT", 50052),
		},
	}, nil
}

func LoadFromEnv() *Config {
	hostKeysEnv := os.Getenv("AGENT_HOST_KEYS")
	hostKeys := []string{"/etc/ssh/ssh_host_rsa_key"}
	if hostKeysEnv != "" {
		hostKeys = parseHostKeys(hostKeysEnv)
	}

	// Get CA public key from environment (base64 encoded for certificate authentication)
	trustedUserCAKeysEncoded := os.Getenv("AGENT_TRUSTED_USER_CA_KEYS")
	var trustedUserCAKeys string
	if trustedUserCAKeysEncoded != "" {
		// Decode base64-encoded CA key
		decoded, err := base64.StdEncoding.DecodeString(trustedUserCAKeysEncoded)
		if err != nil {
			log.Printf("Warning: failed to decode CA key: %v", err)
			trustedUserCAKeys = ""
		} else {
			trustedUserCAKeys = string(decoded)
		}
	}

	return &Config{
		Agent: AgentConfig{
			Token:     os.Getenv("AGENT_TOKEN"),
			ServerURL: os.Getenv("AGENT_SERVER_URL"),
			SandboxID: os.Getenv("AGENT_SANDBOX_ID"),
		},
		SSH: SSHConfig{
			Port:             getEnvIntOrDefault("AGENT_SSH_PORT", 22),
			HostKeys:         hostKeys,
			MaxSessions:      getEnvIntOrDefault("AGENT_MAX_SESSIONS", 10),
			IdleTimeout:      getEnvIntOrDefault("AGENT_IDLE_TIMEOUT", 1800),
			TrustedUserCAKeys: trustedUserCAKeys,
		},
		GRPC: GRPCConfig{
			Port: getEnvIntOrDefault("AGENT_GRPC_PORT", 50052),
		},
	}
}

func parseHostKeys(env string) []string {
	keys := []string{}
	for _, key := range splitComma(env) {
		key = strings.TrimSpace(key)
		if key != "" {
			keys = append(keys, key)
		}
	}
	if len(keys) == 0 {
		return []string{"/etc/ssh/ssh_host_rsa_key"}
	}
	return keys
}

func splitComma(s string) []string {
	if s == "" {
		return []string{}
	}
	parts := strings.Split(s, ",")
	return parts
}

func getEnvIntOrDefault(key string, defaultVal int) int {
	val := os.Getenv(key)
	if val == "" {
		return defaultVal
	}
	result, err := strconv.Atoi(val)
	if err != nil {
		return defaultVal
	}
	return result
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
	if c.SSH.Port <= 0 {
		return fmt.Errorf("SSH port must be positive")
	}
	if c.GRPC.Port <= 0 {
		return fmt.Errorf("gRPC port must be positive")
	}
	return nil
}
