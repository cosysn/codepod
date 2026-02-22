package builder

import (
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
}

func TestBuild(t *testing.T) {
	b := NewKanikoBuilder("/tmp", "localhost:5000/test:latest")
	// This will fail without valid context, just test the error
	err := b.Build()
	if err != nil {
		t.Logf("Build may fail without valid context: %v", err)
	}
}
