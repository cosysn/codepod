// Package multiplex provides cmux-based SSH + gRPC port multiplexing
package multiplex

import (
	"fmt"
	"io"
	"net"

	"github.com/soheilhy/cmux"
)

// sshMatcher creates a cmux matcher that detects SSH protocol connections
// by checking for the "SSH-" protocol header
func sshMatcher(r io.Reader) bool {
	buf := make([]byte, 4)
	n, err := r.Read(buf)
	if err != nil || n < 4 {
		return false
	}
	return string(buf) == "SSH-"
}

// Server manages multiplexed SSH + gRPC server
type Server struct {
	sshAddr     string
	sshHandler  func(net.Listener) error
	grpcHandler func(net.Listener) error
	listener    net.Listener
}

// New creates a new multiplex server
func New(sshAddr string, sshHandler func(net.Listener) error, grpcHandler func(net.Listener) error) *Server {
	return &Server{
		sshAddr:     sshAddr,
		sshHandler:  sshHandler,
		grpcHandler: grpcHandler,
	}
}

// Start starts the multiplexed server
func (s *Server) Start() error {
	// Create a TCP listener
	listener, err := net.Listen("tcp", s.sshAddr)
	if err != nil {
		return fmt.Errorf("failed to listen on %s: %w", s.sshAddr, err)
	}

	// Store listener reference for graceful shutdown
	s.listener = listener

	// Create cmux matcher
	m := cmux.New(listener)

	// Match SSH connections using custom matcher to detect "SSH-" protocol header
	sshListener := m.Match(sshMatcher)

	// Match HTTP/2 for gRPC
	grpcListener := m.Match(cmux.HTTP2())

	// Start SSH server in goroutine
	go func() {
		if err := s.sshHandler(sshListener); err != nil {
			fmt.Printf("SSH server error: %v\n", err)
		}
	}()

	// Start gRPC server in goroutine
	go func() {
		if err := s.grpcHandler(grpcListener); err != nil {
			fmt.Printf("gRPC server error: %v\n", err)
		}
	}()

	// Start serving - this blocks and routes connections to matched listeners
	// It will return when the listener is closed (e.g., by Stop())
	return m.Serve()
}

// Stop gracefully stops the multiplexed server
func (s *Server) Stop() {
	if s.listener != nil {
		s.listener.Close()
	}
}
