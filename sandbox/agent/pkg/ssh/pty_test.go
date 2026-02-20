package ssh

import (
	"testing"
)

func TestPTYAllocator_Allocate(t *testing.T) {
	alloc := NewPTYAllocator()

	pty, err := alloc.Allocate()
	if err != nil {
		t.Fatalf("failed to allocate PTY: %v", err)
	}

	if pty.Master == nil {
		t.Error("PTY master should not be nil")
	}
	if pty.Slave == nil {
		t.Error("PTY slave should not be nil")
	}

	// Cleanup
	pty.Close()
}

func TestPTYAllocator_WindowSize(t *testing.T) {
	alloc := NewPTYAllocator()
	pty, _ := alloc.Allocate()
	defer pty.Close()

	// Set window size
	err := pty.Resize(80, 24)
	if err != nil {
		t.Fatalf("failed to resize: %v", err)
	}
}
