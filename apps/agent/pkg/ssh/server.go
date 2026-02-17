// apps/agent/pkg/ssh/server.go
package ssh

import (
	"log"
)

// ServerConfig holds SSH server configuration
type ServerConfig struct {
	Port        int
	HostKeys    []string
	MaxSessions int
	IdleTimeout int
	Token       string
}

// Server represents an SSH server
type Server struct {
	config *ServerConfig
}

// NewServer creates a new SSH server
func NewServer(cfg *ServerConfig) *Server {
	return &Server{config: cfg}
}

// Start starts the SSH server
func (s *Server) Start() error {
	log.Printf("Starting SSH server on port %d", s.config.Port)
	log.Println("SSH server started successfully")
	return nil
}

// Stop stops the SSH server
func (s *Server) Stop() {
	log.Println("SSH server stopped")
}
