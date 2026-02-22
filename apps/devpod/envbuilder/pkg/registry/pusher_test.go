package registry

import (
	"errors"
	"testing"
)

// MockCommandRunner is a mock implementation of CommandRunner for testing
type MockCommandRunner struct {
	RunFunc    func(name string, args ...string) error
	OutputFunc func(name string, args ...string) ([]byte, error)
}

func (m *MockCommandRunner) Run(name string, args ...string) error {
	if m.RunFunc != nil {
		return m.RunFunc(name, args...)
	}
	return nil
}

func (m *MockCommandRunner) Output(name string, args ...string) ([]byte, error) {
	if m.OutputFunc != nil {
		return m.OutputFunc(name, args...)
	}
	return nil, nil
}

func TestNewPusher(t *testing.T) {
	p := NewPusher("localhost:5000")
	if p.registry != "localhost:5000" {
		t.Errorf("expected registry localhost:5000, got %s", p.registry)
	}
}

func TestPushImage_ValidatesEmptyImageName(t *testing.T) {
	mockRunner := &MockCommandRunner{}
	p := NewPusherWithRunner("localhost:5000", mockRunner)

	err := p.PushImage("")
	if err == nil {
		t.Error("expected error for empty image name")
	}
	if err.Error() != "image name cannot be empty" {
		t.Errorf("unexpected error message: %s", err.Error())
	}
}

func TestPushImage_ValidatesWhitespaceImageName(t *testing.T) {
	mockRunner := &MockCommandRunner{}
	p := NewPusherWithRunner("localhost:5000", mockRunner)

	err := p.PushImage("   ")
	if err == nil {
		t.Error("expected error for whitespace-only image name")
	}
	if err.Error() != "image name cannot be empty" {
		t.Errorf("unexpected error message: %s", err.Error())
	}
}

func TestPushImage_Success(t *testing.T) {
	mockRunner := &MockCommandRunner{
		OutputFunc: func(name string, args ...string) ([]byte, error) {
			return nil, nil
		},
		RunFunc: func(name string, args ...string) error {
			return nil
		},
	}
	p := NewPusherWithRunner("localhost:5000", mockRunner)

	err := p.PushImage("test-image:latest")
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestPushImage_TagFailure(t *testing.T) {
	mockRunner := &MockCommandRunner{
		OutputFunc: func(name string, args ...string) ([]byte, error) {
			return []byte("tag not found"), errors.New("no such image")
		},
	}
	p := NewPusherWithRunner("localhost:5000", mockRunner)

	err := p.PushImage("test-image:latest")
	if err == nil {
		t.Error("expected error for tag failure")
	}
}

func TestPushImage_PushFailure(t *testing.T) {
	mockRunner := &MockCommandRunner{
		OutputFunc: func(name string, args ...string) ([]byte, error) {
			return nil, nil
		},
		RunFunc: func(name string, args ...string) error {
			return errors.New("connection refused")
		},
	}
	p := NewPusherWithRunner("localhost:5000", mockRunner)

	err := p.PushImage("test-image:latest")
	if err == nil {
		t.Error("expected error for push failure")
	}
}
