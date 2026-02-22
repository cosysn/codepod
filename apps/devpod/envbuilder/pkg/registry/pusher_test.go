package registry

import (
	"testing"
)

func TestNewPusher(t *testing.T) {
	p := NewPusher("localhost:5000")
	if p.registry != "localhost:5000" {
		t.Errorf("expected registry localhost:5000, got %s", p.registry)
	}
}

func TestPushImage(t *testing.T) {
	p := NewPusher("localhost:5000")
	// This will fail without a real image, just test the error
	err := p.PushImage("test-image:latest")
	if err == nil {
		t.Error("expected error for non-existent image")
	}
}
