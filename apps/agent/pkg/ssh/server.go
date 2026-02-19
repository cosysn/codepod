package ssh

import (
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"os/exec"
	"sync"
	"syscall"

	"golang.org/x/crypto/ssh"
)

type ServerConfig struct {
	Port        int
	HostKeys    []string
	MaxSessions int
	Token       string
	IdleTimeout int
}

type SSHServer struct {
	config     *ServerConfig
	mu         sync.RWMutex
	listeners  []net.Listener
	running    bool
	sessionMgr *SessionManager
}

func NewServer(cfg *ServerConfig) *SSHServer {
	return &SSHServer{
		config:     cfg,
		sessionMgr: NewSessionManager(),
	}
}

// SetSessionManager sets the session manager (for testing)
func (s *SSHServer) SetSessionManager(mgr *SessionManager) {
	s.sessionMgr = mgr
}

func (s *SSHServer) Start(ctx context.Context) error {
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return fmt.Errorf("server already running")
	}
	s.running = true
	s.mu.Unlock()

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
		select {
		case <-ctx.Done():
			s.Stop()
			return ctx.Err()
		default:
			conn, err := listener.Accept()
			if err != nil {
				if s.isShuttingDown() {
					return nil
				}
				log.Printf("Failed to accept connection: %v", err)
				continue
			}
			go s.handleConnection(conn)
		}
	}
}

func (s *SSHServer) isShuttingDown() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return !s.running
}

func (s *SSHServer) handleConnection(conn net.Conn) {
	serverConfig := &ssh.ServerConfig{
		PasswordCallback: func(conn ssh.ConnMetadata, password []byte) (*ssh.Permissions, error) {
			if string(password) == s.config.Token {
				return &ssh.Permissions{}, nil
			}
			return nil, fmt.Errorf("invalid password")
		},
	}

	// Add host keys
	log.Printf("Loading host keys from: %v", s.config.HostKeys)
	hostKeyCount := 0
	for _, keyPath := range s.config.HostKeys {
		key, err := loadHostKey(keyPath)
		if err != nil {
			log.Printf("Warning: failed to load host key %s: %v", keyPath, err)
			continue
		}
		log.Printf("Successfully loaded host key: %s", keyPath)
		serverConfig.AddHostKey(key)
		hostKeyCount++
	}
	if hostKeyCount == 0 {
		log.Printf("WARNING: No host keys loaded! SSH server will not be able to accept connections.")
	}

	sshConn, chans, reqs, err := ssh.NewServerConn(conn, serverConfig)
	if err != nil {
		log.Printf("Failed to establish SSH connection: %v", err)
		return
	}
	defer sshConn.Close()

	// Handle requests in a separate goroutine
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

		go s.handleSession(channel, requests, sshConn.User())
	}
}

func (s *SSHServer) handleSession(channel ssh.Channel, requests <-chan *ssh.Request, user string) {
	log.Printf("New session started for user: %s", user)

	// Wait for the first request to determine session type
	var sessionType SessionType = SessionTypeInteractive
	var command string
	var cols uint16 = 80
	var rows uint16 = 24

	// Process requests until we have enough info to start the session
	for {
		select {
		case req, ok := <-requests:
			if !ok {
				log.Printf("Session channel closed for user: %s", user)
				channel.Close()
				return
			}

			log.Printf("Received request type: %s", req.Type)

			switch req.Type {
			case "shell":
				// Interactive shell session
				sessionType = SessionTypeInteractive
				log.Printf("Starting interactive shell for user: %s", user)
				req.Reply(true, nil)
				// Break out to create session
				goto createSession
			case "exec":
				// Single command execution
				var execReq execRequest
				if err := ssh.Unmarshal(req.Payload, &execReq); err == nil {
					command = execReq.Command
					sessionType = SessionTypeExec
					log.Printf("Executing command for user %s: %s", user, command)
				}
				req.Reply(true, nil)
				// Break out to create session
				goto createSession
			case "env":
				// Environment variable request - just acknowledge it
				log.Printf("Received env request from user: %s", user)
				req.Reply(true, nil)
				// Continue to wait for more requests
			case "pty-req":
				// PTY request with window size
				var ptyReq ptyRequest
				if err := ssh.Unmarshal(req.Payload, &ptyReq); err == nil {
					cols = ptyReq.Columns
					rows = ptyReq.Rows
					sessionType = SessionTypeInteractive
					log.Printf("PTY requested: cols=%d, rows=%d", cols, rows)
				}
				req.Reply(true, nil)
				// Continue to wait for more requests
			default:
				log.Printf("Unknown request type: %s", req.Type)
				req.Reply(true, nil)
			}
		}
	}

createSession:

	// Create session
	session, err := s.sessionMgr.Create(&SessionConfig{
		Type:    sessionType,
		User:    user,
		Cols:    cols,
		Rows:    rows,
		Command: command,
	})
	if err != nil {
		log.Printf("Failed to create session: %v", err)
		channel.Close()
		return
	}

	// Handle remaining requests
	go func() {
		for req := range requests {
			switch req.Type {
			case "window-change":
				var termReq termRequest
				if err := ssh.Unmarshal(req.Payload, &termReq); err == nil {
					if termReq.Columns > 0 && termReq.Rows > 0 {
						session.PTY.Resize(uint16(termReq.Columns), uint16(termReq.Rows))
					}
				}
				req.Reply(true, nil)
			default:
				req.Reply(false, nil)
			}
		}
	}()

	// Execute based on session type
	if sessionType == SessionTypeExec {
		s.handleExec(channel, session, command)
	} else {
		s.handleShell(channel, session)
	}
}

func (s *SSHServer) handleShell(channel ssh.Channel, session *Session) {
	// Start shell process
	cmd, err := s.startShell(session)
	if err != nil {
		log.Printf("Failed to start shell: %v", err)
		s.sessionMgr.Close(session.ID)
		channel.Close()
		return
	}

	// Copy data between channel and PTY
	go io.Copy(channel, session.PTY.Master)
	go io.Copy(session.PTY.Master, channel)

	// Wait for command to finish
	cmd.Wait()

	// Send exit status
	var exitCode int
	if cmd.ProcessState != nil {
		exitCode = cmd.ProcessState.ExitCode()
	}

	channel.SendRequest("exit-status", false, ssh.Marshal(&exitStatusMsg{
		ExitStatus: uint32(exitCode),
	}))

	s.sessionMgr.Close(session.ID)
	channel.Close()
	log.Printf("Shell session closed for user: %s", session.User)
}

func (s *SSHServer) handleExec(channel ssh.Channel, session *Session, command string) {
	defer s.sessionMgr.Close(session.ID)
	defer channel.Close()

	log.Printf("Executing command: %s", command)

	// Execute command without PTY
	cmd := exec.Command("/bin/sh", "-c", command)
	output, err := cmd.Output()

	// Send exit status first
	var exitCode int
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			exitCode = 1
		}
		log.Printf("Exec command '%s' failed with exit code %d: %v", command, exitCode, err)
	} else {
		exitCode = 0
		log.Printf("Exec command '%s' succeeded", command)
	}

	// Send exit status
	channel.SendRequest("exit-status", false, ssh.Marshal(&exitStatusMsg{
		ExitStatus: uint32(exitCode),
	}))

	// Send output if any
	if err == nil && len(output) > 0 {
		channel.Write(output)
	}

	log.Printf("Exec completed: %s (exit code: %d)", command, exitCode)
}

type ptyRequest struct {
	Term     string
	Columns  uint16
	Rows     uint16
	Width    uint16
	Height   uint16
}

type execRequest struct {
	Command string
}

type termRequest struct {
	Term     string
	Columns  uint32
	Rows     uint32
	Width    uint32
	Height   uint32
}

type exitStatusMsg struct {
	ExitStatus uint32
}

func (s *SSHServer) startShell(session *Session) (*exec.Cmd, error) {
	cmd := exec.Command("/bin/sh")
	cmd.Stdin = session.PTY.Slave
	cmd.Stdout = session.PTY.Slave
	cmd.Stderr = session.PTY.Slave
	cmd.SysProcAttr = &syscall.SysProcAttr{
		Setsid: true,
	}

	if err := cmd.Start(); err != nil {
		return nil, err
	}

	return cmd, nil
}

func (s *SSHServer) Stop() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.running = false
	for _, listener := range s.listeners {
		listener.Close()
	}
	s.listeners = nil
	return nil
}

// loadHostKey loads an SSH private key file
func loadHostKey(path string) (ssh.Signer, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read key file: %w", err)
	}
	signer, err := ssh.ParsePrivateKey(data)
	if err != nil {
		return nil, fmt.Errorf("failed to parse key: %w", err)
	}
	return signer, nil
}
