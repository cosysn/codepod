package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config represents the Agent configuration
type Config struct {
	Server  ServerConfig
	SSH     SSHConfig
	Sandbox SandboxConfig
	Idle    IdleConfig
	Logging LoggingConfig
}

// ServerConfig holds Server connection settings
type ServerConfig struct {
	URL   string
	Token string
}

// SSHConfig holds SSH server settings
type SSHConfig struct {
	Port        int
	HostKeys    []string
	MaxSessions int
	Banner      string
}

// SandboxConfig holds sandbox settings
type SandboxConfig struct {
	ID        string
	Workspace string
}

// IdleConfig holds idle management settings
type IdleConfig struct {
	Enabled    bool
	Timeout    time.Duration
	WarnBefore time.Duration
}

// LoggingConfig holds logging settings
type LoggingConfig struct {
	Level  string
	Format string
}

// Load reads and parses the configuration file
func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read config file: %w", err)
	}

	cfg := &Config{
		Server:  ServerConfig{},
		SSH:     SSHConfig{},
		Sandbox: SandboxConfig{},
		Idle:    IdleConfig{Enabled: true},
		Logging: LoggingConfig{},
	}

	// Simple YAML parser
	var currentSection string
	lines := strings.Split(string(data), "\n")
	for _, line := range lines {
		line = strings.TrimRight(line, "\r")

		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}

		// Calculate indentation level
		indent := len(line) - len(trimmed)

		// Only detect top-level sections (no indentation)
		// Check if this is a section header (ends with ":", no ": " after key)
		if indent == 0 && strings.HasSuffix(trimmed, ":") {
			sectionName := strings.TrimSuffix(trimmed, ":")
			// Skip if it looks like a key-value (contains ": ")
			if !strings.Contains(trimmed, ": ") {
				currentSection = sectionName
			}
			continue
		}

		// Skip list items for now
		if strings.HasPrefix(trimmed, "- ") {
			continue
		}

		// Parse key-value pairs
		parts := strings.SplitN(trimmed, ":", 2)
		if len(parts) != 2 {
			continue
		}

		key := strings.TrimSpace(parts[0])
		value := strings.TrimSpace(parts[1])
		value = strings.Trim(value, "\"")
		value = os.ExpandEnv(value)

		switch currentSection {
		case "server":
			switch key {
			case "url":
				cfg.Server.URL = value
			case "token":
				cfg.Server.Token = value
			}
		case "ssh":
			switch key {
			case "port":
				cfg.SSH.Port, _ = strconv.Atoi(value)
			case "host_keys":
				cfg.SSH.HostKeys = append(cfg.SSH.HostKeys, value)
			case "max_sessions":
				cfg.SSH.MaxSessions, _ = strconv.Atoi(value)
			case "banner":
				cfg.SSH.Banner = value
			}
		case "sandbox":
			switch key {
			case "id":
				cfg.Sandbox.ID = value
			case "workspace":
				cfg.Sandbox.Workspace = value
			}
		case "idle":
			switch key {
			case "enabled":
				cfg.Idle.Enabled = value == "true" || value == "yes"
			case "timeout":
				cfg.Idle.Timeout, _ = time.ParseDuration(value)
			case "warn_before":
				cfg.Idle.WarnBefore, _ = time.ParseDuration(value)
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

	cfg.applyDefaults()
	return cfg, nil
}

func (c *Config) applyDefaults() {
	if c.SSH.Port == 0 {
		c.SSH.Port = 22
	}
	if c.SSH.MaxSessions == 0 {
		c.SSH.MaxSessions = 10
	}
	if c.Sandbox.Workspace == "" {
		c.Sandbox.Workspace = "/workspace"
	}
	if c.Idle.Timeout == 0 {
		c.Idle.Timeout = 30 * time.Minute
	}
	if c.Idle.WarnBefore == 0 {
		c.Idle.WarnBefore = 2 * time.Minute
	}
	if c.Logging.Level == "" {
		c.Logging.Level = "info"
	}
	if c.Logging.Format == "" {
		c.Logging.Format = "json"
	}
}

func (c *Config) Validate() error {
	if c.SSH.Port <= 0 || c.SSH.Port > 65535 {
		return fmt.Errorf("invalid SSH port: %d", c.SSH.Port)
	}
	if c.Sandbox.ID == "" {
		return fmt.Errorf("sandbox ID is required")
	}
	return nil
}

func LoadFromEnv() *Config {
	cfg := &Config{
		Server: ServerConfig{
			URL:   os.Getenv("CODEPOD_AGENT_URL"),
			Token: os.Getenv("CODEPOD_AGENT_TOKEN"),
		},
		SSH: SSHConfig{
			Port:        getEnvIntOrDefault("CODEPOD_SSH_PORT", 22),
			MaxSessions: getEnvIntOrDefault("CODEPOD_MAX_SESSIONS", 10),
			Banner:      os.Getenv("CODEPOD_SSH_BANNER"),
		},
		Sandbox: SandboxConfig{
			ID:        os.Getenv("CODEPOD_SANDBOX_ID"),
			Workspace: getEnvOrDefault("CODEPOD_WORKSPACE", "/workspace"),
		},
		Idle: IdleConfig{
			Enabled:    os.Getenv("CODEPOD_IDLE_ENABLED") != "false",
			Timeout:    getEnvDurationOrDefault("CODEPOD_IDLE_TIMEOUT", 30*time.Minute),
			WarnBefore: getEnvDurationOrDefault("CODEPOD_IDLE_WARN", 2*time.Minute),
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

func getEnvDurationOrDefault(key string, defaultValue time.Duration) time.Duration {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	d, _ := time.ParseDuration(value)
	return d
}
