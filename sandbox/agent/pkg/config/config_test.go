package config

import (
	"os"
	"testing"
)

func TestLoadFromEnv(t *testing.T) {
	os.Setenv("AGENT_TOKEN", "test-token")
	os.Setenv("AGENT_SERVER_URL", "http://localhost:8080")
	os.Setenv("AGENT_SANDBOX_ID", "sbox-123")
	os.Setenv("AGENT_SSH_PORT", "2222")
	os.Setenv("AGENT_MAX_SESSIONS", "5")
	defer os.Unsetenv("AGENT_TOKEN")
	defer os.Unsetenv("AGENT_SERVER_URL")
	defer os.Unsetenv("AGENT_SANDBOX_ID")
	defer os.Unsetenv("AGENT_SSH_PORT")
	defer os.Unsetenv("AGENT_MAX_SESSIONS")

	cfg := LoadFromEnv()

	if cfg.Agent.Token != "test-token" {
		t.Errorf("expected token test-token, got %s", cfg.Agent.Token)
	}
	if cfg.Agent.ServerURL != "http://localhost:8080" {
		t.Errorf("expected URL http://localhost:8080, got %s", cfg.Agent.ServerURL)
	}
	if cfg.Agent.SandboxID != "sbox-123" {
		t.Errorf("expected sandbox ID sbox-123, got %s", cfg.Agent.SandboxID)
	}
	if cfg.SSH.Port != 2222 {
		t.Errorf("expected port 2222, got %d", cfg.SSH.Port)
	}
	if cfg.SSH.MaxSessions != 5 {
		t.Errorf("expected max sessions 5, got %d", cfg.SSH.MaxSessions)
	}
}

func TestLoadFromEnvDefaults(t *testing.T) {
	os.Unsetenv("AGENT_TOKEN")
	os.Unsetenv("AGENT_SERVER_URL")
	os.Unsetenv("AGENT_SANDBOX_ID")
	os.Unsetenv("AGENT_SSH_PORT")
	os.Unsetenv("AGENT_MAX_SESSIONS")
	defer os.Unsetenv("AGENT_TOKEN")
	defer os.Unsetenv("AGENT_SERVER_URL")
	defer os.Unsetenv("AGENT_SANDBOX_ID")
	defer os.Unsetenv("AGENT_SSH_PORT")
	defer os.Unsetenv("AGENT_MAX_SESSIONS")

	cfg := LoadFromEnv()

	if cfg.SSH.Port != 22 {
		t.Errorf("expected default port 22, got %d", cfg.SSH.Port)
	}
	if cfg.SSH.MaxSessions != 10 {
		t.Errorf("expected default max sessions 10, got %d", cfg.SSH.MaxSessions)
	}
	if cfg.SSH.IdleTimeout != 1800 {
		t.Errorf("expected default idle timeout 1800, got %d", cfg.SSH.IdleTimeout)
	}
}

func TestConfigValidation(t *testing.T) {
	// Valid config
	validCfg := &Config{
		Agent: AgentConfig{
			Token:     "test-token",
			SandboxID: "sbox-123",
			ServerURL: "http://localhost:8080",
		},
		SSH:  SSHConfig{Port: 22},
		GRPC: GRPCConfig{Port: 50052},
	}
	if err := validCfg.Validate(); err != nil {
		t.Errorf("expected valid config, got error: %v", err)
	}

	// Invalid port
	invalidPortCfg := &Config{
		Agent: AgentConfig{
			Token:     "test-token",
			SandboxID: "sbox-123",
			ServerURL: "http://localhost:8080",
		},
		SSH:  SSHConfig{Port: 0},
		GRPC: GRPCConfig{Port: 50052},
	}
	if err := invalidPortCfg.Validate(); err == nil {
		t.Error("expected error for invalid port")
	}

	// Missing sandbox ID
	missingIDCfg := &Config{
		Agent: AgentConfig{
			Token:     "test-token",
			SandboxID: "",
			ServerURL: "http://localhost:8080",
		},
		SSH:  SSHConfig{Port: 22},
		GRPC: GRPCConfig{Port: 50052},
	}
	if err := missingIDCfg.Validate(); err == nil {
		t.Error("expected error for missing sandbox ID")
	}

	// Missing token
	missingTokenCfg := &Config{
		Agent: AgentConfig{
			Token:     "",
			SandboxID: "sbox-123",
			ServerURL: "http://localhost:8080",
		},
		SSH:  SSHConfig{Port: 22},
		GRPC: GRPCConfig{Port: 50052},
	}
	if err := missingTokenCfg.Validate(); err == nil {
		t.Error("expected error for missing token")
	}

	// Missing server URL
	missingURLCfg := &Config{
		Agent: AgentConfig{
			Token:     "test-token",
			SandboxID: "sbox-123",
			ServerURL: "",
		},
		SSH:  SSHConfig{Port: 22},
		GRPC: GRPCConfig{Port: 50052},
	}
	if err := missingURLCfg.Validate(); err == nil {
		t.Error("expected error for missing server URL")
	}
}

func TestLoad(t *testing.T) {
	os.Setenv("AGENT_TOKEN", "env-token")
	os.Setenv("AGENT_SERVER_URL", "http://env:8080")
	os.Setenv("AGENT_SANDBOX_ID", "env-sbox")
	defer os.Unsetenv("AGENT_TOKEN")
	defer os.Unsetenv("AGENT_SERVER_URL")
	defer os.Unsetenv("AGENT_SANDBOX_ID")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("failed to load config: %v", err)
	}

	if cfg.Agent.Token != "env-token" {
		t.Errorf("expected token env-token, got %s", cfg.Agent.Token)
	}
	if cfg.Agent.ServerURL != "http://env:8080" {
		t.Errorf("expected URL http://env:8080, got %s", cfg.Agent.ServerURL)
	}
	if cfg.Agent.SandboxID != "env-sbox" {
		t.Errorf("expected sandbox ID env-sbox, got %s", cfg.Agent.SandboxID)
	}
}

func TestSSHHostKeys(t *testing.T) {
	os.Setenv("AGENT_HOST_KEYS", "/etc/ssh/ssh_host_rsa_key")
	defer os.Unsetenv("AGENT_HOST_KEYS")

	cfg := LoadFromEnv()

	// Single host key supported
	if len(cfg.SSH.HostKeys) != 1 {
		t.Errorf("expected 1 host key, got %d", len(cfg.SSH.HostKeys))
	}
	if cfg.SSH.HostKeys[0] != "/etc/ssh/ssh_host_rsa_key" {
		t.Errorf("expected host key /etc/ssh/ssh_host_rsa_key, got %s", cfg.SSH.HostKeys[0])
	}
}

func TestIdleTimeout(t *testing.T) {
	os.Setenv("AGENT_IDLE_TIMEOUT", "3600")
	defer os.Unsetenv("AGENT_IDLE_TIMEOUT")

	cfg := LoadFromEnv()

	if cfg.SSH.IdleTimeout != 3600 {
		t.Errorf("expected idle timeout 3600, got %d", cfg.SSH.IdleTimeout)
	}
}

func TestMultipleHostKeys(t *testing.T) {
	os.Setenv("AGENT_HOST_KEYS", "/etc/ssh/ssh_host_rsa_key,/etc/ssh/ssh_host_ed25519_key")
	defer os.Unsetenv("AGENT_HOST_KEYS")

	cfg := LoadFromEnv()

	if len(cfg.SSH.HostKeys) != 2 {
		t.Errorf("expected 2 host keys, got %d", len(cfg.SSH.HostKeys))
	}
}
