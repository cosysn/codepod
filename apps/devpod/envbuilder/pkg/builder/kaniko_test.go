package builder

import (
	"bytes"
	"context"
	"testing"
)

func TestNewKanikoBuilder(t *testing.T) {
	b := NewKanikoBuilder("/workspace", "localhost:5000/test:latest")
	if b == nil {
		t.Fatal("expected non-nil builder")
	}

	if b.context != "/workspace" {
		t.Errorf("expected context /workspace, got %s", b.context)
	}

	if b.image != "localhost:5000/test:latest" {
		t.Errorf("expected image localhost:5000/test:latest, got %s", b.image)
	}

	if b.kanikoPath != "/kaniko/executor" {
		t.Errorf("expected default kanikoPath /kaniko/executor, got %s", b.kanikoPath)
	}

	if b.stdout == nil {
		t.Error("expected non-nil stdout")
	}

	if b.stderr == nil {
		t.Error("expected non-nil stderr")
	}
}

func TestSetDockerfile(t *testing.T) {
	b := NewKanikoBuilder("/workspace", "localhost:5000/test:latest")
	result := b.SetDockerfile("Dockerfile.custom")

	// Check that the method returns the builder for chaining
	if result == nil {
		t.Fatal("expected non-nil builder return for chaining")
	}

	// Check that dockerfile is set
	if b.dockerfile != "Dockerfile.custom" {
		t.Errorf("expected dockerfile Dockerfile.custom, got %s", b.dockerfile)
	}

	// Check that context and image are unchanged
	if b.context != "/workspace" {
		t.Errorf("expected context /workspace, got %s", b.context)
	}
	if b.image != "localhost:5000/test:latest" {
		t.Errorf("expected image localhost:5000/test:latest, got %s", b.image)
	}
}

func TestSetKanikoPath(t *testing.T) {
	b := NewKanikoBuilder("/workspace", "localhost:5000/test:latest")
	result := b.SetKanikoPath("/custom/kaniko")

	// Check that the method returns the builder for chaining
	if result == nil {
		t.Fatal("expected non-nil builder return for chaining")
	}

	// Check that kanikoPath is set
	if b.kanikoPath != "/custom/kaniko" {
		t.Errorf("expected kanikoPath /custom/kaniko, got %s", b.kanikoPath)
	}
}

func TestSetStdout(t *testing.T) {
	b := NewKanikoBuilder("/workspace", "localhost:5000/test:latest")
	customWriter := &bytes.Buffer{}
	result := b.SetStdout(customWriter)

	// Check that the method returns the builder for chaining
	if result == nil {
		t.Fatal("expected non-nil builder return for chaining")
	}

	// Check that stdout is set
	if b.stdout != customWriter {
		t.Error("expected stdout to be set to custom writer")
	}
}

func TestSetStderr(t *testing.T) {
	b := NewKanikoBuilder("/workspace", "localhost:5000/test:latest")
	customWriter := &bytes.Buffer{}
	result := b.SetStderr(customWriter)

	// Check that the method returns the builder for chaining
	if result == nil {
		t.Fatal("expected non-nil builder return for chaining")
	}

	// Check that stderr is set
	if b.stderr != customWriter {
		t.Error("expected stderr to be set to custom writer")
	}
}

func TestBuild(t *testing.T) {
	b := NewKanikoBuilder("/tmp", "localhost:5000/test:latest")
	// Use a non-existent kaniko path so we can test the error
	b.SetKanikoPath("/nonexistent/kaniko")

	ctx := context.Background()
	err := b.Build(ctx)

	// Should fail because kaniko doesn't exist at the path
	if err == nil {
		t.Error("expected error for non-existent kaniko path")
	}

	// Verify the error message contains the expected path
	expectedErrMsg := "kaniko binary not found at /nonexistent/kaniko"
	if err.Error() != expectedErrMsg {
		t.Errorf("expected error %q, got %q", expectedErrMsg, err.Error())
	}
}

func TestBuilderInterface(t *testing.T) {
	// Verify that KanikoBuilder implements Builder interface
	var _ Builder = NewKanikoBuilder("/workspace", "localhost:5000/test:latest")
}
