package features

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestResolveFeature(t *testing.T) {
	resolver := NewResolver()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Test resolving a simple feature
	script, err := resolver.Resolve(ctx, "ghcr.io/devcontainers/features/go:1", map[string]any{})
	if err != nil {
		t.Fatalf("Resolve failed: %v", err)
	}

	if script == "" {
		t.Error("expected non-empty script")
	}
}

func TestResolveAllFeatures(t *testing.T) {
	resolver := NewResolver()

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	features := map[string]any{
		"ghcr.io/devcontainers/features/go:1":   map[string]any{},
		"ghcr.io/devcontainers/features/node:1": map[string]any{},
	}

	scripts, err := resolver.ResolveAll(ctx, features)
	if err != nil {
		t.Fatalf("ResolveAll failed: %v", err)
	}

	if len(scripts) != 2 {
		t.Errorf("expected 2 scripts, got %d", len(scripts))
	}
}

func TestResolveWithOptions(t *testing.T) {
	resolver := NewResolverWithBaseURL("https://raw.githubusercontent.com/devcontainers/features/main/src")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Test resolving a feature with options
	options := map[string]any{
		"version": "1.20.0",
		"include": "true",
	}
	script, err := resolver.Resolve(ctx, "ghcr.io/devcontainers/features/go:1", options)
	if err != nil {
		t.Fatalf("Resolve with options failed: %v", err)
	}

	if script == "" {
		t.Error("expected non-empty script")
	}

	// Verify options are injected as environment variables
	expectedExports := []string{
		`export version="1.20.0"`,
		`export include="true"`,
	}
	for _, exp := range expectedExports {
		if !strings.Contains(script, exp) {
			t.Errorf("expected script to contain %q, got: %s", exp, script[:min(len(script), 200)])
		}
	}
}

func TestResolveWithCustomHTTPClient(t *testing.T) {
	customClient := &http.Client{
		Timeout: 10 * time.Second,
	}
	resolver := NewResolverWithOptions("https://raw.githubusercontent.com/devcontainers/features/main/src", customClient)

	if resolver.httpClient != customClient {
		t.Error("expected custom HTTP client to be set")
	}
}

func TestResolveWithCustomBaseURL(t *testing.T) {
	customURL := "https://custom.example.com/features"
	resolver := NewResolverWithBaseURL(customURL)

	if resolver.featuresBaseURL != customURL {
		t.Errorf("expected base URL %q, got %q", customURL, resolver.featuresBaseURL)
	}
}

func TestSetHTTPClient(t *testing.T) {
	resolver := NewResolver()
	customClient := &http.Client{Timeout: 5 * time.Second}

	resolver.SetHTTPClient(customClient)

	if resolver.httpClient != customClient {
		t.Error("expected HTTP client to be updated")
	}
}

func TestSetBaseURL(t *testing.T) {
	resolver := NewResolver()
	newURL := "https://new.example.com/src"

	resolver.SetBaseURL(newURL)

	if resolver.featuresBaseURL != newURL {
		t.Errorf("expected base URL %q, got %q", newURL, resolver.featuresBaseURL)
	}
}

func TestSafeTypeAssertion(t *testing.T) {
	resolver := NewResolver()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	// Test with invalid options type (string instead of map)
	features := map[string]any{
		"ghcr.io/devcontainers/features/go:1": "invalid-options", // This is wrong type
	}

	scripts, err := resolver.ResolveAll(ctx, features)
	if err != nil {
		t.Fatalf("ResolveAll should handle type mismatch gracefully: %v", err)
	}

	// Should still get a result, just with empty options
	if len(scripts) != 1 {
		t.Errorf("expected 1 script, got %d", len(scripts))
	}
}

func TestInjectOptions(t *testing.T) {
	resolver := NewResolver()
	script := []byte("#!/bin/bash\necho hello")

	injected := resolver.injectOptions(script, map[string]any{
		"VERSION": "1.0",
		"DEBUG":  "true",
	})

	expected := `export VERSION="1.0"
export DEBUG="true"
#!/bin/bash
echo hello`

	if string(injected) != expected {
		t.Errorf("expected:\n%s\ngot:\n%s", expected, string(injected))
	}
}

// min returns the minimum of two integers
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
