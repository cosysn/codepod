package config

import (
	"os"
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
