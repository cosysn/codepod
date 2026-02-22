package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestParseDevcontainer(t *testing.T) {
	// Create temp devcontainer.json
	content := `{
		"image": "ubuntu:22.04",
		"features": {
			"ghcr.io/devcontainers/features/go:1": {}
		},
		"onCreateCommand": "apt-get update",
		"postStartCommand": "echo started"
	}`

	tmpfile, err := os.CreateTemp("", "devcontainer-*.json")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(tmpfile.Name())

	if _, err := tmpfile.Write([]byte(content)); err != nil {
		t.Fatal(err)
	}
	tmpfile.Close()

	cfg, err := ParseDevcontainer(tmpfile.Name())
	if err != nil {
		t.Fatalf("ParseDevcontainer failed: %v", err)
	}

	if cfg.Image == nil || *cfg.Image != "ubuntu:22.04" {
		t.Errorf("expected image ubuntu:22.04, got %v", cfg.Image)
	}

	if len(cfg.Features) != 1 {
		t.Errorf("expected 1 feature, got %d", len(cfg.Features))
	}

	if cfg.OnCreateCommand == nil || len(*cfg.OnCreateCommand) != 1 {
		t.Error("expected onCreateCommand to have 1 command")
	}

	if cfg.PostStartCommand == nil || len(*cfg.PostStartCommand) != 1 {
		t.Error("expected postStartCommand to have 1 command")
	}
}

func TestParseDevcontainerArrayCommands(t *testing.T) {
	// Test array input for commands
	content := `{
		"image": "ubuntu:22.04",
		"onCreateCommand": ["cmd1", "cmd2"],
		"updateContentCommand": ["update1", "update2"],
		"postCreateCommand": ["postcreate1", "postcreate2"],
		"postStartCommand": ["start1", "start2", "start3"]
	}`

	tmpfile, err := os.CreateTemp("", "devcontainer-*.json")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(tmpfile.Name())

	if _, err := tmpfile.Write([]byte(content)); err != nil {
		t.Fatal(err)
	}
	tmpfile.Close()

	cfg, err := ParseDevcontainer(tmpfile.Name())
	if err != nil {
		t.Fatalf("ParseDevcontainer failed: %v", err)
	}

	// Test onCreateCommand array
	if cfg.OnCreateCommand == nil || len(*cfg.OnCreateCommand) != 2 {
		t.Errorf("expected onCreateCommand to have 2 commands, got %v", cfg.OnCreateCommand)
	} else {
		if (*cfg.OnCreateCommand)[0] != "cmd1" || (*cfg.OnCreateCommand)[1] != "cmd2" {
			t.Errorf("expected onCreateCommand [cmd1, cmd2], got %v", *cfg.OnCreateCommand)
		}
	}

	// Test UpdateContentCommand array
	if cfg.UpdateContentCommand == nil || len(*cfg.UpdateContentCommand) != 2 {
		t.Errorf("expected updateContentCommand to have 2 commands, got %v", cfg.UpdateContentCommand)
	} else {
		if (*cfg.UpdateContentCommand)[0] != "update1" || (*cfg.UpdateContentCommand)[1] != "update2" {
			t.Errorf("expected updateContentCommand [update1, update2], got %v", *cfg.UpdateContentCommand)
		}
	}

	// Test PostCreateCommand array
	if cfg.PostCreateCommand == nil || len(*cfg.PostCreateCommand) != 2 {
		t.Errorf("expected postCreateCommand to have 2 commands, got %v", cfg.PostCreateCommand)
	} else {
		if (*cfg.PostCreateCommand)[0] != "postcreate1" || (*cfg.PostCreateCommand)[1] != "postcreate2" {
			t.Errorf("expected postCreateCommand [postcreate1, postcreate2], got %v", *cfg.PostCreateCommand)
		}
	}

	// Test PostStartCommand array with 3 elements
	if cfg.PostStartCommand == nil || len(*cfg.PostStartCommand) != 3 {
		t.Errorf("expected postStartCommand to have 3 commands, got %v", cfg.PostStartCommand)
	}
}

func TestParseDevcontainerNonExistentFile(t *testing.T) {
	_, err := ParseDevcontainer("/nonexistent/path/devcontainer.json")
	if err == nil {
		t.Error("expected error for non-existent file, got nil")
	}
}

func TestParseDevcontainerMalformedJSON(t *testing.T) {
	content := `{invalid json`

	tmpfile, err := os.CreateTemp("", "devcontainer-*.json")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(tmpfile.Name())

	if _, err := tmpfile.Write([]byte(content)); err != nil {
		t.Fatal(err)
	}
	tmpfile.Close()

	_, err = ParseDevcontainer(tmpfile.Name())
	if err == nil {
		t.Error("expected error for malformed JSON, got nil")
	}
}

func TestParseDevcontainerEmptyJSONObject(t *testing.T) {
	// Test with empty JSON object (valid but minimal)
	content := `{}`

	tmpfile, err := os.CreateTemp("", "devcontainer-*.json")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(tmpfile.Name())

	if _, err := tmpfile.Write([]byte(content)); err != nil {
		t.Fatal(err)
	}
	tmpfile.Close()

	cfg, err := ParseDevcontainer(tmpfile.Name())
	if err != nil {
		t.Fatalf("ParseDevcontainer failed for empty JSON object: %v", err)
	}

	// Empty JSON object should return empty config
	if cfg.Image != nil {
		t.Errorf("expected nil image, got %v", cfg.Image)
	}
}

func TestParseDevcontainerWithWorkspaceFolder(t *testing.T) {
	content := `{
		"image": "ubuntu:22.04",
		"workspaceFolder": "/workspace"
	}`

	tmpfile, err := os.CreateTemp("", "devcontainer-*.json")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(tmpfile.Name())

	if _, err := tmpfile.Write([]byte(content)); err != nil {
		t.Fatal(err)
	}
	tmpfile.Close()

	cfg, err := ParseDevcontainer(tmpfile.Name())
	if err != nil {
		t.Fatalf("ParseDevcontainer failed: %v", err)
	}

	if cfg.WorkspaceFolder == nil || *cfg.WorkspaceFolder != "/workspace" {
		t.Errorf("expected workspaceFolder /workspace, got %v", cfg.WorkspaceFolder)
	}
}

func TestParseDevcontainerWithDockerfile(t *testing.T) {
	content := `{
		"dockerFile": "./Dockerfile",
		"context": "."
	}`

	tmpDir := t.TempDir()
	devcontainerPath := filepath.Join(tmpDir, "devcontainer.json")
	err := os.WriteFile(devcontainerPath, []byte(content), 0644)
	if err != nil {
		t.Fatal(err)
	}

	cfg, err := ParseDevcontainer(devcontainerPath)
	if err != nil {
		t.Fatalf("ParseDevcontainer failed: %v", err)
	}

	if cfg.DockerFile == nil || *cfg.DockerFile != "./Dockerfile" {
		t.Errorf("expected dockerFile ./Dockerfile, got %v", cfg.DockerFile)
	}
}
