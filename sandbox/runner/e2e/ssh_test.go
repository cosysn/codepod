package e2e

import (
	"fmt"
	"net"
	"time"

	"golang.org/x/crypto/ssh"
)

// SSHClient represents an SSH connection to a sandbox
type SSHClient struct {
	client *ssh.Client
}

// Connect attempts SSH connection with retries
func Connect(host string, port int, user, password string, retries int) (*SSHClient, error) {
	var lastErr error

	for i := 0; i < retries; i++ {
		// First check if port is open
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", host, port), 2*time.Second)
		if err == nil {
			conn.Close()
		} else {
			time.Sleep(2 * time.Second)
			continue
		}

		// Try SSH connection
		config := &ssh.ClientConfig{
			User: user,
			Auth: []ssh.AuthMethod{
				ssh.Password(password),
			},
			HostKeyCallback: ssh.InsecureIgnoreHostKey(),
			Timeout:         10 * time.Second,
		}

		client, err := ssh.Dial("tcp", fmt.Sprintf("%s:%d", host, port), config)
		if err == nil {
			return &SSHClient{client: client}, nil
		}
		lastErr = err
		time.Sleep(2 * time.Second)
	}
	return nil, fmt.Errorf("failed to connect after %d retries: %w", retries, lastErr)
}

// Run executes a command and returns output
func (s *SSHClient) Run(cmd string) (string, error) {
	session, err := s.client.NewSession()
	if err != nil {
		return "", err
	}
	defer session.Close()

	output, err := session.CombinedOutput(cmd)
	return string(output), err
}

// Close closes the SSH connection
func (s *SSHClient) Close() error {
	return s.client.Close()
}
