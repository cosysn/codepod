package config

import (
	"os"
	"testing"
	"time"
)

func TestLoadConfig(t *testing.T) {
	content := `
server:
  url: "http://localhost:8080"
  token: "test-token"

ssh:
  port: 2222
  max_sessions: 5
  banner: "Welcome"

sandbox:
  id: "sbox-123"
  workspace: "/app"

idle:
  enabled: true
  timeout: 1h
  warn_before: 5m

logging:
  level: "debug"
  format: "json"
`

	tmpFile, err := os.CreateTemp("", "agent-config-*.yaml")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	defer os.Remove(tmpFile.Name())

	if _, err := tmpFile.WriteString(content); err != nil {
		t.Fatalf("failed to write temp file: %v", err)
	}
	tmpFile.Close()

	cfg, err := Load(tmpFile.Name())
	if err != nil {
		t.Fatalf("failed to load config: %v", err)
	}

	if cfg.Server.URL != "http://localhost:8080" {
		t.Errorf("expected URL http://localhost:8080, got %s", cfg.Server.URL)
	}
	if cfg.Server.Token != "test-token" {
		t.Errorf("expected token test-token, got %s", cfg.Server.Token)
	}
	if cfg.SSH.Port != 2222 {
		t.Errorf("expected port 2222, got %d", cfg.SSH.Port)
	}
	if cfg.SSH.MaxSessions != 5 {
		t.Errorf("expected max sessions 5, got %d", cfg.SSH.MaxSessions)
	}
	if cfg.Sandbox.ID != "sbox-123" {
		t.Errorf("expected sandbox ID sbox-123, got %s", cfg.Sandbox.ID)
	}
	if cfg.Sandbox.Workspace != "/app" {
		t.Errorf("expected workspace /app, got %s", cfg.Sandbox.Workspace)
	}
	if cfg.Idle.Timeout != time.Hour {
		t.Errorf("expected timeout 1h, got %v", cfg.Idle.Timeout)
	}
	if cfg.Idle.Enabled != true {
		t.Errorf("expected idle enabled")
	}
}

func TestLoadConfigDefaults(t *testing.T) {
	content := `
server:
  url: "http://localhost:8080"
sandbox:
  id: "sbox-123"
`

	tmpFile, err := os.CreateTemp("", "agent-config-minimal-*.yaml")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	defer os.Remove(tmpFile.Name())

	if _, err := tmpFile.WriteString(content); err != nil {
		t.Fatalf("failed to write temp file: %v", err)
	}
	tmpFile.Close()

	cfg, err := Load(tmpFile.Name())
	if err != nil {
		t.Fatalf("failed to load config: %v", err)
	}

	if cfg.SSH.Port != 22 {
		t.Errorf("expected default port 22, got %d", cfg.SSH.Port)
	}
	if cfg.SSH.MaxSessions != 10 {
		t.Errorf("expected default max sessions 10, got %d", cfg.SSH.MaxSessions)
	}
	if cfg.Sandbox.Workspace != "/workspace" {
		t.Errorf("expected default workspace /workspace, got %s", cfg.Sandbox.Workspace)
	}
	if cfg.Idle.Timeout != 30*time.Minute {
		t.Errorf("expected default timeout 30m, got %v", cfg.Idle.Timeout)
	}
	if cfg.Logging.Level != "info" {
		t.Errorf("expected default level info, got %s", cfg.Logging.Level)
	}
}

func TestConfigValidation(t *testing.T) {
	// Valid config
	validCfg := &Config{
		SSH: SSHConfig{Port: 22},
		Sandbox: SandboxConfig{ID: "sbox-123"},
	}
	if err := validCfg.Validate(); err != nil {
		t.Errorf("expected valid config, got error: %v", err)
	}

	// Invalid port
	invalidPortCfg := &Config{
		SSH: SSHConfig{Port: 0},
		Sandbox: SandboxConfig{ID: "sbox-123"},
	}
	if err := invalidPortCfg.Validate(); err == nil {
		t.Error("expected error for invalid port")
	}

	// Missing sandbox ID
	missingIDCfg := &Config{
		SSH: SSHConfig{Port: 22},
		Sandbox: SandboxConfig{ID: ""},
	}
	if err := missingIDCfg.Validate(); err == nil {
		t.Error("expected error for missing sandbox ID")
	}
}

func TestLoadFromEnv(t *testing.T) {
	os.Setenv("CODEPOD_SSH_PORT", "3333")
	os.Setenv("CODEPOD_WORKSPACE", "/custom")
	defer os.Unsetenv("CODEPOD_SSH_PORT")
	defer os.Unsetenv("CODEPOD_WORKSPACE")

	cfg := LoadFromEnv()

	if cfg.SSH.Port != 3333 {
		t.Errorf("expected port 3333, got %d", cfg.SSH.Port)
	}
	if cfg.Sandbox.Workspace != "/custom" {
		t.Errorf("expected workspace /custom, got %s", cfg.Sandbox.Workspace)
	}
}

func TestSSHHostKeys(t *testing.T) {
	content := `
server:
  url: "http://localhost:8080"
ssh:
  host_keys: /etc/ssh/ssh_host_rsa_key
  max_sessions: 5
sandbox:
  id: "sbox-123"
`

	tmpFile, err := os.CreateTemp("", "agent-config-keys-*.yaml")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	defer os.Remove(tmpFile.Name())

	if _, err := tmpFile.WriteString(content); err != nil {
		t.Fatalf("failed to write temp file: %v", err)
	}
	tmpFile.Close()

	cfg, err := Load(tmpFile.Name())
	if err != nil {
		t.Fatalf("failed to load config: %v", err)
	}

	// Single host key supported
	if len(cfg.SSH.HostKeys) != 1 {
		t.Errorf("expected 1 host key, got %d", len(cfg.SSH.HostKeys))
	}
}
