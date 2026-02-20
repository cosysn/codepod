package ssh

import (
	"os"
	"sync"

	"github.com/creack/pty"
)

// PTY represents a pseudo-terminal pair
type PTY struct {
	Master *os.File
	Slave  *os.File
	Window *WindowSize
}

// WindowSize represents terminal dimensions
type WindowSize struct {
	Rows    uint16
	Cols    uint16
	X       uint16
	Y       uint16
}

// PTYAllocator manages PTY allocation
type PTYAllocator struct {
	mu      sync.Mutex
	counter uint32
}

// NewPTYAllocator creates a new allocator
func NewPTYAllocator() *PTYAllocator {
	return &PTYAllocator{}
}

// Allocate creates a new PTY pair using creack/pty
func (a *PTYAllocator) Allocate() (*PTY, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	ptmx, tty, err := pty.Open()
	if err != nil {
		return nil, err
	}

	return &PTY{
		Master: ptmx,
		Slave:  tty,
		Window: &WindowSize{Rows: 24, Cols: 80},
	}, nil
}

// Resize updates the window size
func (p *PTY) Resize(cols, rows uint16) error {
	p.Window = &WindowSize{
		Cols: cols,
		Rows: rows,
	}
	return pty.Setsize(p.Master, &pty.Winsize{
		Rows: rows,
		Cols: cols,
	})
}

// Close closes both PTY ends
func (p *PTY) Close() error {
	if p.Master != nil {
		p.Master.Close()
	}
	if p.Slave != nil {
		p.Slave.Close()
	}
	return nil
}
