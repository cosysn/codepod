package ssh

import (
	"fmt"
	"os/exec"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

type SessionManager struct {
	mu       sync.RWMutex
	sessions map[string]*Session
}

type Session struct {
	ID        string
	User      string
	Cmd       *exec.Cmd
	ExitChan  chan error
	StartTime time.Time
}

func NewSessionManager() *SessionManager {
	return &SessionManager{
		sessions: make(map[string]*Session),
	}
}

func (sm *SessionManager) StartShell(channel ssh.Channel) error {
	shell := exec.Command("/bin/sh")

	// For simplicity, run without PTY first
	// PTY support can be added later using github.com/creack/pty
	shell.Stdin = channel
	shell.Stdout = channel
	shell.Stderr = channel

	if err := shell.Start(); err != nil {
		return fmt.Errorf("failed to start shell: %w", err)
	}

	session := &Session{
		ID:        fmt.Sprintf("%d", time.Now().UnixNano()),
		User:      "root",
		Cmd:       shell,
		ExitChan:  make(chan error),
		StartTime: time.Now(),
	}

	sm.mu.Lock()
	sm.sessions[session.ID] = session
	sm.mu.Unlock()

	// Wait for shell to exit
	go func() {
		err := shell.Wait()
		channel.Close()
		session.ExitChan <- err
		close(session.ExitChan)
		sm.mu.Lock()
		delete(sm.sessions, session.ID)
		sm.mu.Unlock()
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
	session, ok := sm.sessions[id]
	if !ok {
		sm.mu.Unlock()
		return fmt.Errorf("session not found: %s", id)
	}
	delete(sm.sessions, id)
	sm.mu.Unlock()

	// Kill process if still running
	if session.Cmd.Process != nil {
		session.Cmd.Process.Kill()
	}

	return nil
}
