package hooks

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestExecutor_New(t *testing.T) {
	e := NewExecutor("/opt/hooks", WithStdout(os.Stdout), WithStderr(os.Stderr))
	if e.hooksDir != "/opt/hooks" {
		t.Errorf("expected hooksDir /opt/hooks, got %s", e.hooksDir)
	}
}

func TestExecuteHook(t *testing.T) {
	// Create a temp directory for hooks
	tmpDir, err := os.MkdirTemp("", "hooks-test")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create a marker file that the hook will create to verify execution
	markerPath := filepath.Join(tmpDir, "marker.txt")

	e := NewExecutor(tmpDir)
	err = e.ExecuteHook("onCreateCommand", []string{fmt.Sprintf("echo executed > %s", markerPath)})
	if err != nil {
		t.Fatalf("ExecuteHook failed: %v", err)
	}

	// Verify hook file was created
	hookPath := filepath.Join(tmpDir, "onCreateCommand")
	if _, err := os.Stat(hookPath); os.IsNotExist(err) {
		t.Fatalf("hook file was not created at %s", hookPath)
	}

	// Verify hook was actually executed by checking marker file
	markerContent, err := os.ReadFile(markerPath)
	if err != nil {
		t.Fatalf("hook was not executed: marker file not found at %s", markerPath)
	}
	if string(markerContent) != "executed\n" {
		t.Fatalf("unexpected marker content: %q", string(markerContent))
	}
}

func TestWriteHookToImage(t *testing.T) {
	// Create a temp directory for test
	tmpDir, err := os.MkdirTemp("", "dockerfile-test")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	dockerfilePath := filepath.Join(tmpDir, "Dockerfile")

	e := NewExecutor(tmpDir)
	err = e.WriteHookToImage("postStartCommand", []string{"echo started"}, dockerfilePath)
	if err != nil {
		t.Errorf("WriteHookToImage failed: %v", err)
	}

	// Verify Dockerfile was created with content
	content, err := os.ReadFile(dockerfilePath)
	if err != nil {
		t.Errorf("failed to read Dockerfile: %v", err)
	}

	expectedContent := "RUN echo started\n"
	if string(content) != expectedContent {
		t.Errorf("expected Dockerfile content %q, got %q", expectedContent, string(content))
	}
}
