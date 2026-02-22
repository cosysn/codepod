package features

import (
	"testing"
)

func TestResolveFeature(t *testing.T) {
	resolver := NewResolver()

	// Test resolving a simple feature
	script, err := resolver.Resolve("ghcr.io/devcontainers/features/go:1", map[string]any{})
	if err != nil {
		t.Fatalf("Resolve failed: %v", err)
	}

	if script == "" {
		t.Error("expected non-empty script")
	}
}

func TestResolveAllFeatures(t *testing.T) {
	resolver := NewResolver()

	features := map[string]any{
		"ghcr.io/devcontainers/features/go:1":   map[string]any{},
		"ghcr.io/devcontainers/features/node:1": map[string]any{},
	}

	scripts, err := resolver.ResolveAll(features)
	if err != nil {
		t.Fatalf("ResolveAll failed: %v", err)
	}

	if len(scripts) != 2 {
		t.Errorf("expected 2 scripts, got %d", len(scripts))
	}
}
