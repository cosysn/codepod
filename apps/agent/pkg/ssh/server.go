package ssh

import (
	"context"
	"fmt"
	"log"
	"net"
	"sync"

	"golang.org/x/crypto/ssh"
)

type ServerConfig struct {
	Port        int
	HostKeys    []string
	MaxSessions int
	Token       string
}

type SSHServer struct {
	config    *ServerConfig
	mu        sync.RWMutex
	listeners []net.Listener
}

func NewServer(cfg *ServerConfig) *SSHServer {
	return &SSHServer{config: cfg}
}

func (s *SSHServer) Start() error {
	addr := fmt.Sprintf(":%d", s.config.Port)
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("failed to listen on %s: %w", addr, err)
	}
	s.mu.Lock()
	s.listeners = append(s.listeners, listener)
	s.mu.Unlock()

	log.Printf("SSH Server listening on %s", addr)

	for {
		conn, err := listener.Accept()
		if err != nil {
			log.Printf("Failed to accept connection: %v", err)
			continue
		}
		go s.handleConnection(conn)
	}
}

func (s *SSHServer) handleConnection(conn net.Conn) {
	serverConfig := &ssh.ServerConfig{
		AuthMethods: []ssh.AuthMethod{
			&serverPasswordAuth{s.config.Token},
		},
	}

	sshConn, chans, reqs, err := ssh.NewServerConn(conn, serverConfig)
	if err != nil {
		log.Printf("Failed to establish SSH connection: %v", err)
		return
	}
	defer sshConn.Close()

	go ssh.DiscardRequests(reqs)

	for newChannel := range chans {
		if newChannel.ChannelType() != "session" {
			newChannel.Reject(ssh.UnknownChannelType, "unknown channel type")
			continue
		}

		channel, requests, err := newChannel.Accept()
		if err != nil {
			log.Printf("Failed to accept channel: %v", err)
			continue
		}
		go ssh.DiscardRequests(requests)
		go s.handleSession(channel)
	}
}

func (s *SSHServer) handleSession(channel ssh.Channel) {
	log.Printf("New session started")
	// Session handling will be implemented in Task 3

	// Keep connection alive until closed
	buffer := make([]byte, 1024)
	for {
		_, err := channel.Read(buffer)
		if err != nil {
			break
		}
	}
	channel.Close()
}

func (s *SSHServer) Stop() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, listener := range s.listeners {
		listener.Close()
	}
	s.listeners = nil
	return nil
}
