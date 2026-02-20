package ssh

import (
	"fmt"
	"sync"
	"time"
)

// SessionType represents the type of session
type SessionType string

const (
	SessionTypeInteractive SessionType = "interactive"
	SessionTypeExec       SessionType = "exec"
	SessionTypeSubsystem  SessionType = "subsystem"
)

// SessionStatus represents session state
type SessionStatus string

const (
	SessionStatusActive    SessionStatus = "active"
	SessionStatusClosing SessionStatus = "closing"
	SessionStatusClosed  SessionStatus = "closed"
)

// Session represents an SSH session
type Session struct {
	ID         string
	Type       SessionType
	User       string
	Status     SessionStatus
	PTY        *PTY
	Command    string
	StartTime  time.Time
	WindowCols uint16
	WindowRows uint16
}

// SessionConfig configures a new session
type SessionConfig struct {
	Type       SessionType
	User       string
	Cols       uint16
	Rows       uint16
	Command    string
	WorkingDir string
}

// SessionManager manages SSH sessions
type SessionManager struct {
	mu       sync.RWMutex
	sessions map[string]*Session
	ptyAlloc *PTYAllocator
}

// NewSessionManager creates a new manager
func NewSessionManager() *SessionManager {
	return &SessionManager{
		sessions: make(map[string]*Session),
		ptyAlloc: NewPTYAllocator(),
	}
}

// Create creates a new session
func (m *SessionManager) Create(cfg *SessionConfig) (*Session, error) {
	pty, err := m.ptyAlloc.Allocate()
	if err != nil {
		return nil, fmt.Errorf("failed to allocate PTY: %w", err)
	}

	if cfg.Cols == 0 {
		cfg.Cols = 80
	}
	if cfg.Rows == 0 {
		cfg.Rows = 24
	}

	session := &Session{
		ID:         fmt.Sprintf("session-%d", time.Now().UnixNano()),
		Type:       cfg.Type,
		User:       cfg.User,
		Status:     SessionStatusActive,
		PTY:        pty,
		Command:    cfg.Command,
		StartTime:  time.Now(),
		WindowCols: cfg.Cols,
		WindowRows: cfg.Rows,
	}

	m.mu.Lock()
	m.sessions[session.ID] = session
	m.mu.Unlock()

	return session, nil
}

// Get returns a session by ID
func (m *SessionManager) Get(id string) *Session {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.sessions[id]
}

// List returns all sessions
func (m *SessionManager) List() []*Session {
	m.mu.RLock()
	defer m.mu.RUnlock()

	sessions := make([]*Session, 0, len(m.sessions))
	for _, s := range m.sessions {
		sessions = append(sessions, s)
	}
	return sessions
}

// Close closes a session
func (m *SessionManager) Close(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	session, ok := m.sessions[id]
	if !ok {
		return fmt.Errorf("session not found: %s", id)
	}

	session.Status = SessionStatusClosing
	if session.PTY != nil {
		session.PTY.Close()
	}
	delete(m.sessions, id)
	return nil
}

// Count returns the number of active sessions
func (m *SessionManager) Count() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.sessions)
}
