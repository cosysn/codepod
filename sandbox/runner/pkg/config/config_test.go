package config

import (
	"os"
	"testing"
)

func TestLoadConfig(t *testing.T) {
	// Create a temporary config file
	content := `
server:
  url: "localhost:50051"
  token: "test-token"

docker:
  host: "unix:///var/run/docker.sock"
  network: "codepod-test"

runner:
  id: "runner-test-001"
  max_jobs: 5

logging:
  level: "debug"
  format: "json"
`

	tmpFile, err := os.CreateTemp("", "config-*.yaml")
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

	if cfg.Server.URL != "localhost:50051" {
		t.Errorf("expected server URL localhost:50051, got %s", cfg.Server.URL)
	}
	if cfg.Server.Token != "test-token" {
		t.Errorf("expected server token test-token, got %s", cfg.Server.Token)
	}
	if cfg.Docker.Host != "unix:///var/run/docker.sock" {
		t.Errorf("expected docker host unix:///var/run/docker.sock, got %s", cfg.Docker.Host)
	}
	if cfg.Docker.Network != "codepod-test" {
		t.Errorf("expected docker network codepod-test, got %s", cfg.Docker.Network)
	}
	if cfg.Runner.ID != "runner-test-001" {
		t.Errorf("expected runner id runner-test-001, got %s", cfg.Runner.ID)
	}
	if cfg.Runner.MaxJobs != 5 {
		t.Errorf("expected max jobs 5, got %d", cfg.Runner.MaxJobs)
	}
	if cfg.Logging.Level != "debug" {
		t.Errorf("expected log level debug, got %s", cfg.Logging.Level)
	}
}

func TestLoadConfigDefaults(t *testing.T) {
	// Create a minimal config file
	content := `
server:
  url: "localhost:50051"
`

	tmpFile, err := os.CreateTemp("", "config-minimal-*.yaml")
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

	// Check defaults are applied
	if cfg.Docker.Host != "unix:///var/run/docker.sock" {
		t.Errorf("expected default docker host, got %s", cfg.Docker.Host)
	}
	if cfg.Runner.MaxJobs != 10 {
		t.Errorf("expected default max jobs 10, got %d", cfg.Runner.MaxJobs)
	}
	if cfg.Logging.Level != "info" {
		t.Errorf("expected default log level info, got %s", cfg.Logging.Level)
	}
}

func TestLoadConfigEnvVar(t *testing.T) {
	// Create config with env var placeholder
	content := `
server:
  url: "localhost:50051"
  token: "${TEST_TOKEN}"
`

	tmpFile, err := os.CreateTemp("", "config-env-*.yaml")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	defer os.Remove(tmpFile.Name())

	if _, err := tmpFile.WriteString(content); err != nil {
		t.Fatalf("failed to write temp file: %v", err)
	}
	tmpFile.Close()

	// Set env var
	os.Setenv("TEST_TOKEN", "resolved-token")
	defer os.Unsetenv("TEST_TOKEN")

	cfg, err := Load(tmpFile.Name())
	if err != nil {
		t.Fatalf("failed to load config: %v", err)
	}

	if cfg.Server.Token != "resolved-token" {
		t.Errorf("expected resolved token resolved-token, got %s", cfg.Server.Token)
	}
}

func TestLoadConfigFileNotFound(t *testing.T) {
	_, err := Load("/nonexistent/config.yaml")
	if err == nil {
		t.Error("expected error for nonexistent file")
	}
}

func TestConfigValidation(t *testing.T) {
	cfg := &Config{
		Server: ServerConfig{
			URL: "localhost:50051",
		},
		Docker: DockerConfig{
			Host: "unix:///var/run/docker.sock",
		},
	}

	if err := cfg.Validate(); err != nil {
		t.Errorf("expected valid config, got error: %v", err)
	}

	// Test invalid config
	invalidCfg := &Config{
		Server: ServerConfig{
			URL: "", // Empty URL should fail
		},
		Docker: DockerConfig{
			Host: "unix:///var/run/docker.sock",
		},
	}

	if err := invalidCfg.Validate(); err == nil {
		t.Error("expected error for empty server URL")
	}
}
