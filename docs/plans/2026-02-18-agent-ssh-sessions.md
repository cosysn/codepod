# Agent SSH Sessions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 Agent SSH 会话管理，支持交互式 Shell 和命令执行。

**Architecture:**
- Session Manager 管理所有 SSH 会话生命周期
- PTY Allocator 分配伪终端
- 命令执行集成 Process Manager
- 支持窗口大小调整和信号转发

**Tech Stack:**
- Go 1.21
- golang.org/x/crypto/ssh
- golang.org/x/term (PTY support)

---

### Task 1: Create PTY Package

**Files:**
- Create: `apps/agent/pkg/ssh/pty.go` - PTY allocation and window management

**Step 1: Write the failing test**

```go
// apps/agent/pkg/ssh/pty_test.go
package ssh

import (
	"testing"
)

func TestPTYAllocator_Allocate(t *testing.T) {
	alloc := NewPTYAllocator()

	pty, err := alloc.Allocate()
	if err != nil {
		t.Fatalf("failed to allocate PTY: %v", err)
	}

	if pty.Master == nil {
		t.Error("PTY master should not be nil")
	}
	if pty.Slave == nil {
		t.Error("PTY slave should not be nil")
	}

	// Cleanup
	pty.Close()
}

func TestPTYAllocator_WindowSize(t *testing.T) {
	alloc := NewPTYAllocator()
	pty, _ := alloc.Allocate()
	defer pty.Close()

	// Set window size
	err := pty.Resize(80, 24)
	if err != nil {
		t.Fatalf("failed to resize: %v", err)
	}
}
```

**Step 2: Run test to verify it fails**

```bash
cd apps/agent && go test ./pkg/ssh/... -run TestPTY -v
# Expected: FAIL - pty.go doesn't exist
```

**Step 3: Write minimal implementation**

```go
// apps/agent/pkg/ssh/pty.go
package ssh

import (
	"os"
	"sync"

	"golang.org/x/term"
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
	mu     sync.Mutex
	counter uint32
}

// NewPTYAllocator creates a new allocator
func NewPTYAllocator() *PTYAllocator {
	return &PTYAllocator{}
}

// Allocate creates a new PTY pair
func (a *PTYAllocator) Allocate() (*PTY, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	master, slave, err := term.Pty()
	if err != nil {
		return nil, err
	}

	return &PTY{
		Master: master,
		Slave:  slave,
		Window: &WindowSize{Rows: 24, Cols: 80},
	}, nil
}

// Resize updates the window size
func (p *PTY) Resize(cols, rows uint16) error {
	p.Window = &WindowSize{
		Cols: cols,
		Rows: rows,
	}
	return term.SetSize(p.Master, int(rows), int(cols))
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
```

**Step 4: Run test to verify it passes**

```bash
cd apps/agent && go test ./pkg/ssh/... -run TestPTY -v
# Expected: PASS
```

**Step 5: Commit**

```bash
git add apps/agent/pkg/ssh/pty.go apps/agent/pkg/ssh/pty_test.go
git commit -m "feat: add PTY allocator for terminal support"
```

---

### Task 2: Create Session Manager

**Files:**
- Create: `apps/agent/pkg/ssh/session.go` - Session lifecycle management
- Create: `apps/agent/pkg/ssh/session_test.go`

**Step 1: Write the failing test**

```go
// apps/agent/pkg/ssh/session_test.go
package ssh

import (
	"testing"
)

func TestSessionManager_Create(t *testing.T) {
	manager := NewSessionManager()

	session, err := manager.Create(&SessionConfig{
		Type:     SessionTypeInteractive,
		User:     "test",
		Cols:     80,
		Rows:     24,
	})
	if err != nil {
		t.Fatalf("failed to create session: %v", err)
	}

	if session.ID == "" {
		t.Error("session ID should not be empty")
	}

	if session.Status != SessionStatusActive {
		t.Error("session should be active after creation")
	}

	manager.Close(session.ID)
}

func TestSessionManager_List(t *testing.T) {
	manager := NewSessionManager()

	manager.Create(&SessionConfig{Type: SessionTypeInteractive, User: "user1"})
	manager.Create(&SessionConfig{Type: SessionTypeExec, User: "user2"})

	sessions := manager.List()
	if len(sessions) != 2 {
		t.Errorf("expected 2 sessions, got %d", len(sessions))
	}
}
```

**Step 2: Run test to verify it fails**

```bash
cd apps/agent && go test ./pkg/ssh/... -run TestSession -v
# Expected: FAIL - session.go doesn't exist
```

**Step 3: Write minimal implementation**

```go
// apps/agent/pkg/ssh/session.go
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
	SessionStatusActive   SessionStatus = "active"
	SessionStatusClosing SessionStatus = "closing"
	SessionStatusClosed  SessionStatus = "closed"
)

// Session represents an SSH session
type Session struct {
	ID        string
	Type      SessionType
	User      string
	Status    SessionStatus
	PTY       *PTY
	Command   string
	StartTime time.Time
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
```

**Step 4: Run test to verify it passes**

```bash
cd apps/agent && go test ./pkg/ssh/... -run TestSession -v
# Expected: PASS
```

**Step 5: Commit**

```bash
git add apps/agent/pkg/ssh/session.go apps/agent/pkg/ssh/session_test.go
git commit -m "feat: add session manager for SSH session lifecycle"
```

---

### Task 3: Implement handleSession with Shell Execution

**Files:**
- Modify: `apps/agent/pkg/ssh/server.go` - Implement shell execution

**Step 1: Write the failing test**

```go
// apps/agent/pkg/ssh/server_shell_test.go
package ssh

import (
	"testing"
)

func TestSSHServer_HandleShell(t *testing.T) {
	server := &SSHServer{
		config: &ServerConfig{
			Port:     2222,
			MaxSessions: 10,
			Token:    "test-token",
		},
		sessionMgr: NewSessionManager(),
	}

	// Test session creation
	session, err := server.sessionMgr.Create(&SessionConfig{
		Type: SessionTypeInteractive,
		User: "test",
		Cols: 80,
		Rows: 24,
	})
	if err != nil {
		t.Fatalf("failed to create session: %v", err)
	}

	if session.PTY == nil {
		t.Error("session should have PTY")
	}

	server.sessionMgr.Close(session.ID)
}
```

**Step 2: Run test to verify it fails**

```bash
cd apps/agent && go test ./pkg/ssh/... -run TestSSHServer_HandleShell -v
# Expected: FAIL - sessionMgr field doesn't exist
```

**Step 3: Write implementation**

```go
// apps/agent/pkg/ssh/server.go - Updated

type SSHServer struct {
	config      *ServerConfig
	mu          sync.RWMutex
	listeners   []net.Listener
	running     bool
	sessionMgr  *SessionManager  // ADD THIS
	processMgr *process.Manager  // ADD THIS - import from pkg/process
}
```

**Step 4: Add shell execution to handleSession**

```go
// apps/agent/pkg/ssh/server.go

func (s *SSHServer) handleSession(channel ssh.Channel, req *ssh.Request) {
	session, err := s.sessionMgr.Create(&SessionConfig{
		Type: SessionTypeInteractive,
		User: "root",
		Cols: 80,
		Rows: 24,
	})
	if err != nil {
		log.Printf("Failed to create session: %v", err)
		channel.Close()
		return
	}
	defer s.sessionMgr.Close(session.ID)

	// Set initial window size
	if req != nil {
		var termReq termRequest
		if err := ssh.Unmarshal(req.Payload, &termReq); err == nil {
			session.WindowCols = termReq.Columns
			session.WindowRows = termReq.Rows
			session.PTY.Resize(session.WindowCols, session.WindowRows)
		}
	}

	// Start shell process
	cmd, err := s.startShell(session)
	if err != nil {
		log.Printf("Failed to start shell: %v", err)
		return
	}

	// Copy data between channel and PTY
	go copyPtyToChannel(session.PTY.Master, channel)
	go copyChannelToPty(channel, session.PTY.Master)

	// Wait for command to finish
	cmd.Wait()

	// Send exit status
	status := cmd.ProcessState.ExitCode()
	channel.SendRequest("exit-status", false, ssh.Marshal(&exitStatusMsg{
		ExitStatus: uint32(status),
	}))

	channel.Close()
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

func copyPtyToChannel(ptyMaster *os.File, channel ssh.Channel) {
	io.Copy(channel, ptyMaster)
}

func copyChannelToPty(channel ssh.Channel, ptyMaster *os.File) {
	io.Copy(ptyMaster, channel)
}
```

**Step 4: Run test to verify it passes**

```bash
cd apps/agent && go test ./pkg/ssh/... -run TestSSHServer_HandleShell -v
# Expected: PASS
```

**Step 5: Commit**

```bash
git add apps/agent/pkg/ssh/server.go
git commit -m "feat: implement shell execution in SSH session"
```

---

### Task 4: Handle Window Resize Requests

**Files:**
- Modify: `apps/agent/pkg/ssh/server.go` - Add window resize handling

**Step 1: Write the failing test**

```go
// apps/agent/pkg/ssh/server_window_test.go
package ssh

import (
	"testing"
)

func TestSSHServer_WindowResize(t *testing.T) {
	server := &SSHServer{
		config:     &ServerConfig{Port: 2222},
		sessionMgr: NewSessionManager(),
	}

	session, _ := server.sessionMgr.Create(&SessionConfig{
		Type: SessionTypeInteractive,
		User: "test",
		Cols: 80,
		Rows: 24,
	})
	defer server.sessionMgr.Close(session.ID)

	// Resize
	err := session.PTY.Resize(120, 40)
	if err != nil {
		t.Fatalf("failed to resize: %v", err)
	}
}
```

**Step 2: Add window resize handling**

```go
// Add to handleSession - handle window-change requests
go func() {
	for {
		req, ok := <-requests
		if !ok {
			break
		}
		switch req.Type {
		case "window-change":
			var termReq termRequest
			if err := ssh.Unmarshal(req.Payload, &termReq); err == nil {
				session.PTY.Resize(termReq.Columns, termReq.Rows)
			}
		}
		req.Reply(true, nil)
	}
}()
```

**Step 3: Run test**

```bash
cd apps/agent && go test ./pkg/ssh/... -run TestSSHServer_WindowResize -v
# Expected: PASS
```

**Step 4: Commit**

```bash
git add apps/agent/pkg/ssh/server.go
git commit -m "feat: add window resize handling for SSH sessions"
```

---

### Task 5: Handle exec Request Type

**Files:**
- Modify: `apps/agent/pkg/ssh/server.go` - Support single command execution

**Step 1: Write the failing test**

```go
// apps/agent/pkg/ssh/server_exec_test.go
package ssh

import (
	"testing"
)

func TestSSHServer_HandleExec(t *testing.T) {
	server := &SSHServer{
		config:     &ServerConfig{Port: 2222, Token: "test"},
		sessionMgr: NewSessionManager(),
	}

	// Test exec command creation
	session, err := server.sessionMgr.Create(&SessionConfig{
		Type:    SessionTypeExec,
		User:    "root",
		Command: "echo hello",
	})
	if err != nil {
		t.Fatalf("failed to create exec session: %v", err)
	}

	if session.Command != "echo hello" {
		t.Error("session command should be set")
	}
}
```

**Step 2: Add exec channel handling**

```go
// In handleConnection, check for exec requests
for req := range requests {
	switch req.Type {
	case "shell":
		s.handleSession(channel, req)
	case "exec":
		var execReq execRequest
		if err := ssh.Unmarshal(req.Payload, &execReq); err == nil {
			session, _ := s.sessionMgr.Create(&SessionConfig{
				Type:    SessionTypeExec,
				User:    sshConn.User(),
				Command: execReq.Command,
			})
			go s.handleExec(channel, session, execReq.Command)
		}
	}
}

type execRequest struct {
	Command string
}
```

**Step 3: Implement handleExec**

```go
func (s *SSHServer) handleExec(channel ssh.Channel, session *Session, command string) {
	defer s.sessionMgr.Close(session.ID)
	defer channel.Close()

	// Execute command without PTY
	cmd := exec.Command("/bin/sh", "-c", command)
	stdout, err := cmd.Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			channel.SendRequest("exit-status", false, ssh.Marshal(&exitStatusMsg{
				ExitStatus: uint32(exitErr.ExitCode()),
			}))
		}
		return
	}

	channel.Write(stdout)
	channel.SendRequest("exit-status", false, ssh.Marshal(&exitStatusMsg{
		ExitStatus: 0,
	}))
}
```

**Step 4: Run test**

```bash
cd apps/agent && go test ./pkg/ssh/... -run TestSSHServer_HandleExec -v
# Expected: PASS
```

**Step 5: Commit**

```bash
git add apps/agent/pkg/ssh/server.go
git commit -m "feat: add exec command support for SSH sessions"
```

---

### Task 6: Integration Test

**Files:**
- Create: `apps/agent/e2e/ssh_session_test.go` - End-to-end SSH test

**Step 1: Create integration test**

```go
// apps/agent/e2e/ssh_session_test.go
package e2e

import (
	"net"
	"testing"

	"golang.org/x/crypto/ssh"
)

func TestSSH_SessionLifecycle(t *testing.T) {
	// Start SSH server (in real test, you'd start the actual server)
	// Connect via SSH client
	config := &ssh.ClientConfig{
		User: "root",
		Auth: []ssh.AuthMethod{
			ssh.Password("test-token"),
		},
	}

	client, err := ssh.Dial("tcp", "localhost:22", config)
	if err != nil {
		t.Fatalf("failed to dial: %v", err)
	}
	defer client.Close()

	// Open a session
	session, err := client.NewSession()
	if err != nil {
		t.Fatalf("failed to create session: %v", err)
	}
	defer session.Close()

	// Test exec
	output, err := session.Output("echo hello")
	if err != nil {
		t.Fatalf("exec failed: %v", err)
	}
	if string(output) != "hello\n" {
		t.Errorf("expected 'hello\\n', got '%s'", string(output))
	}
}
```

**Step 2: Run integration test**

```bash
cd apps/agent && go test ./e2e/... -v
# Expected: PASS (requires running server)
```

**Step 3: Commit**

```bash
git add apps/agent/e2e/ssh_session_test.go
git commit -m "test: add SSH session integration tests"
```

---

### Task 7: Update main.go to Use Session Manager

**Files:**
- Modify: `apps/agent/cmd/main.go` - Integrate new session manager

**Step 1: Update main.go**

```go
// apps/agent/cmd/main.go

func main() {
	// ... existing code ...

	// Create session manager
	sessionMgr := ssh.NewSessionManager()

	// Create process manager
	procMgr := process.NewManager()

	// Create SSH server with session and process managers
	server := ssh.NewServer(&ssh.ServerConfig{
		Port:        cfg.SSH.Port,
		HostKeys:    cfg.SSH.HostKeys,
		MaxSessions: cfg.SSH.MaxSessions,
		Token:       cfg.Agent.Token,
	})
	server.SetSessionManager(sessionMgr)
	server.SetProcessManager(procMgr)

	// ... rest of code ...
}
```

**Step 2: Add setter methods to SSHServer**

```go
// Add to server.go
func (s *SSHServer) SetSessionManager(mgr *SessionManager) {
	s.sessionMgr = mgr
}

func (s *SSHServer) SetProcessManager(mgr *process.Manager) {
	s.processMgr = mgr
}
```

**Step 3: Verify build**

```bash
cd apps/agent && go build ./...
```

**Step 4: Commit**

```bash
git add apps/agent/cmd/main.go apps/agent/pkg/ssh/server.go
git commit -m "feat: integrate session manager into main agent"
```

---

### Task 8: Add Dependencies

**Files:**
- Modify: `apps/agent/go.mod`

**Step 1: Add x/term dependency**

```bash
cd apps/agent && go get golang.org/x/term@v0.15.0
```

**Step 2: Commit**

```bash
git add apps/agent/go.mod apps/agent/go.sum
git commit -m "deps: add golang.org/x/term for PTY support"
```

---

## Execution Handoff

**Plan complete and saved to `docs/plans/2026-02-18-agent-ssh-sessions.md`. Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
