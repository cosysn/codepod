// Package multiplex provides cmux-based SSH + gRPC port multiplexing
package multiplex

import (
	"fmt"
	"net"

	"github.com/soheilhy/cmux"
)

// Server manages multiplexed SSH + gRPC server
type Server struct {
	sshAddr     string
	sshHandler  func(net.Listener) error
	grpcHandler func(net.Listener) error
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

	// Create cmux matcher
	m := cmux.New(listener)

	// Match SSH - use Any() since SSH protocol has specific prefix
	sshListener := m.Match(cmux.Any())

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

	// Block until closed
	return m.Serve()
}
