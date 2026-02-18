package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Config represents the Runner configuration
type Config struct {
	Server  ServerConfig
	Docker  DockerConfig
	Runner  RunnerConfig
	Agent   AgentConfig
	Logging LoggingConfig
}

// AgentConfig holds Agent settings
type AgentConfig struct {
	BinaryPath string // Path to the agent binary
	Token      string // Default token for agent authentication
}

// ServerConfig holds Server connection settings
type ServerConfig struct {
	URL   string
	Token string
}

// DockerConfig holds Docker settings
type DockerConfig struct {
	Host    string
	Network string
}

// RunnerConfig holds Runner settings
type RunnerConfig struct {
	ID      string
	MaxJobs int
}

// LoggingConfig holds logging settings
type LoggingConfig struct {
	Level  string
	Format string
}

// Load reads and parses the configuration file (simple YAML parser)
func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read config file: %w", err)
	}

	cfg := &Config{
		Server:  ServerConfig{},
		Docker:  DockerConfig{},
		Runner:  RunnerConfig{},
		Logging: LoggingConfig{},
	}

	// Parse YAML with section support
	var currentSection string
	lines := strings.Split(string(data), "\n")
	for _, line := range lines {
		line = strings.TrimRight(line, "\r")

		// Skip empty lines and comments
		if strings.TrimSpace(line) == "" || strings.HasPrefix(strings.TrimSpace(line), "#") {
			continue
		}

		// Calculate indentation
		section := strings.TrimSpace(line)

		// Check if this is a section header (no colon in value part)
		if strings.HasSuffix(section, ":") && !strings.Contains(section, ": ") && !strings.Contains(section, ":\"" ) {
			currentSection = strings.TrimSuffix(section, ":")
			continue
		}

		// Parse key-value pairs
		parts := strings.SplitN(section, ":", 2)
		if len(parts) != 2 {
			continue
		}

		key := strings.TrimSpace(parts[0])
		value := strings.TrimSpace(parts[1])

		// Remove quotes if present
		value = strings.Trim(value, "\"")

		// Resolve environment variables
		value = os.ExpandEnv(value)

		// Set value based on section and key
		switch currentSection {
		case "server":
			switch key {
			case "url":
				cfg.Server.URL = value
			case "token":
				cfg.Server.Token = value
			}
		case "docker":
			switch key {
			case "host":
				cfg.Docker.Host = value
			case "network":
				cfg.Docker.Network = value
			}
		case "runner":
			switch key {
			case "id":
				cfg.Runner.ID = value
			case "max_jobs":
				cfg.Runner.MaxJobs, _ = strconv.Atoi(value)
			}
		case "logging":
			switch key {
			case "level":
				cfg.Logging.Level = value
			case "format":
				cfg.Logging.Format = value
			}
		}
	}

	// Apply defaults
	cfg.applyDefaults()

	return cfg, nil
}

// applyDefaults sets default values for missing configuration
func (c *Config) applyDefaults() {
	if c.Docker.Host == "" {
		c.Docker.Host = "unix:///var/run/docker.sock"
	}
	if c.Docker.Network == "" {
		c.Docker.Network = "codepod"
	}
	if c.Runner.MaxJobs == 0 {
		c.Runner.MaxJobs = 10
	}
	if c.Logging.Level == "" {
		c.Logging.Level = "info"
	}
	if c.Logging.Format == "" {
		c.Logging.Format = "json"
	}
	// Default agent binary path - can be overridden by env var
	if c.Agent.BinaryPath == "" {
		c.Agent.BinaryPath = "/usr/local/bin/agent"
	}
}

// Validate checks if the configuration is valid
func (c *Config) Validate() error {
	if c.Server.URL == "" {
		return fmt.Errorf("server URL is required")
	}
	if c.Docker.Host == "" {
		return fmt.Errorf("docker host is required")
	}
	return nil
}

// LoadFromEnv loads configuration from environment variables
func LoadFromEnv() *Config {
	cfg := &Config{
		Server: ServerConfig{
			URL:   os.Getenv("CODEPOD_SERVER_URL"),
			Token: os.Getenv("CODEPOD_SERVER_TOKEN"),
		},
		Docker: DockerConfig{
			Host:    getEnvOrDefault("CODEPOD_DOCKER_HOST", "unix:///var/run/docker.sock"),
			Network: getEnvOrDefault("CODEPOD_DOCKER_NETWORK", "codepod"),
		},
		Runner: RunnerConfig{
			ID:      os.Getenv("CODEPOD_RUNNER_ID"),
			MaxJobs: getEnvIntOrDefault("CODEPOD_MAX_JOBS", 10),
		},
		Agent: AgentConfig{
			BinaryPath: getEnvOrDefault("CODEPOD_AGENT_BINARY_PATH", ""),
			Token:      os.Getenv("CODEPOD_AGENT_TOKEN"),
		},
		Logging: LoggingConfig{
			Level:  getEnvOrDefault("CODEPOD_LOG_LEVEL", "info"),
			Format: getEnvOrDefault("CODEPOD_LOG_FORMAT", "json"),
		},
	}

	cfg.applyDefaults()
	return cfg
}

func getEnvOrDefault(key, defaultValue string) string {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	return value
}

func getEnvIntOrDefault(key string, defaultValue int) int {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	result, _ := strconv.Atoi(value)
	return result
}
