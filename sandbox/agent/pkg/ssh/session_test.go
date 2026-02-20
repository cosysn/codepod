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
