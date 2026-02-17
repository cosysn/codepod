package ssh

import (
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/term"
)

type SessionManager struct {
	mu       sync.RWMutex
	sessions map[string]*Session
}

type Session struct {
	ID        string
	User      string
	Pty       *term.Pty
	Cmd       *exec.Cmd
	ExitChan  chan int
	StartTime time.Time
}

func NewSessionManager() *SessionManager {
	return &SessionManager{
		sessions: make(map[string]*Session),
	}
}

func (sm *SessionManager) StartShell(channel ssh.Channel) error {
	shell := exec.Command("/bin/sh")

	pty, err := term.Pty()
	if err != nil {
		return fmt.Errorf("failed to create pty: %w", err)
	}

	shell.Stdin = pty
	shell.Stdout = pty
	shell.Stderr = pty

	if err := shell.Start(); err != nil {
		return fmt.Errorf("failed to start shell: %w", err)
	}

	session := &Session{
		ID:        fmt.Sprintf("%d", time.Now().UnixNano()),
		User:      "root",
		Pty:       pty,
		Cmd:       shell,
		ExitChan:  make(chan int),
		StartTime: time.Now(),
	}

	sm.mu.Lock()
	sm.sessions[session.ID] = session
	sm.mu.Unlock()

	// Wait for shell to exit
	go func() {
		exitCode := shell.Wait()
		close(session.ExitChan)
		sm.mu.Lock()
		delete(sm.sessions, session.ID)
		sm.mu.Unlock()
	}()

	// Copy data between channel and pty
	go func() {
		_, err := io.Copy(channel, pty)
		if err != nil {
			log.Printf("pty to channel copy error: %v", err)
		}
		channel.Close()
	}()

	go func() {
		_, err := io.Copy(pty, channel)
		if err != nil {
			log.Printf("channel to pty copy error: %v", err)
		}
	}()

	return nil
}

func (sm *SessionManager) ListSessions() []*Session {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	sessions := make([]*Session, 0, len(sm.sessions))
	for _, s := range sm.sessions {
		sessions = append(sessions, s)
	}
	return sessions
}

func (sm *SessionManager) GetSession(id string) *Session {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	return sm.sessions[id]
}

func (sm *SessionManager) CloseSession(id string) error {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	session, ok := sm.sessions[id]
	if !ok {
		return fmt.Errorf("session not found: %s", id)
	}
	session.Cmd.Process.Kill()
	delete(sm.sessions, id)
	return nil
}
