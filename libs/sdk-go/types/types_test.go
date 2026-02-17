package types

import (
	"encoding/json"
	"testing"
	"time"
)

func TestSandboxStatusConstants(t *testing.T) {
	tests := []struct {
		status   SandboxStatus
		expected string
	}{
		{SandboxStatusPending, "pending"},
		{SandboxStatusRunning, "running"},
		{SandboxStatusStopped, "stopped"},
		{SandboxStatusFailed, "failed"},
		{SandboxStatusDeleted, "deleted"},
	}

	for _, tt := range tests {
		if string(tt.status) != tt.expected {
			t.Errorf("expected %s, got %s", tt.expected, tt.status)
		}
	}
}

func TestCreateSandboxRequestJSON(t *testing.T) {
	req := CreateSandboxRequest{
		Name:    "test-sandbox",
		Image:   "python:3.11",
		CPU:     2,
		Memory:  "2Gi",
		Env:     map[string]string{"DEBUG": "true"},
		Timeout: time.Hour,
	}

	data, err := json.Marshal(req)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	var decoded CreateSandboxRequest
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if decoded.Name != req.Name {
		t.Errorf("name mismatch: expected %s, got %s", req.Name, decoded.Name)
	}
	if decoded.Image != req.Image {
		t.Errorf("image mismatch: expected %s, got %s", req.Image, decoded.Image)
	}
	if decoded.CPU != req.CPU {
		t.Errorf("cpu mismatch: expected %d, got %d", req.CPU, decoded.CPU)
	}
	if decoded.Memory != req.Memory {
		t.Errorf("memory mismatch: expected %s, got %s", req.Memory, decoded.Memory)
	}
}

func TestCreateSandboxResponseJSON(t *testing.T) {
	resp := CreateSandboxResponse{
		Sandbox: &Sandbox{
			ID:     "sbox-123",
			Name:   "test",
			Status: SandboxStatusRunning,
			Image:  "python:3.11",
		},
		SSHHost: "localhost",
		SSHPort: 2222,
		SSHUser: "root",
		Token:   "test-token",
	}

	data, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	var decoded CreateSandboxResponse
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if decoded.Sandbox.ID != resp.Sandbox.ID {
		t.Errorf("sandbox ID mismatch: expected %s, got %s", resp.Sandbox.ID, decoded.Sandbox.ID)
	}
	if decoded.SSHHost != resp.SSHHost {
		t.Errorf("ssh host mismatch: expected %s, got %s", resp.SSHHost, decoded.SSHHost)
	}
	if decoded.SSHPort != resp.SSHPort {
		t.Errorf("ssh port mismatch: expected %d, got %d", resp.SSHPort, decoded.SSHPort)
	}
}

func TestSandboxJSON(t *testing.T) {
	now := time.Now()
	sb := Sandbox{
		ID:        "sbox-456",
		Name:      "my-sandbox",
		Status:    SandboxStatusRunning,
		Image:     "go:1.21",
		Host:      "192.168.1.100",
		Port:      22,
		User:      "root",
		CreatedAt: now,
	}

	data, err := json.Marshal(sb)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	var decoded Sandbox
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if decoded.ID != sb.ID {
		t.Errorf("id mismatch: expected %s, got %s", sb.ID, decoded.ID)
	}
	if decoded.Status != sb.Status {
		t.Errorf("status mismatch: expected %s, got %s", sb.Status, decoded.Status)
	}
}

func TestErrorResponseJSON(t *testing.T) {
	errResp := ErrorResponse{
		Code:    400,
		Message: "bad request",
		Details: "invalid image name",
	}

	data, err := json.Marshal(errResp)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	var decoded ErrorResponse
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if decoded.Code != errResp.Code {
		t.Errorf("code mismatch: expected %d, got %d", errResp.Code, decoded.Code)
	}
	if decoded.Message != errResp.Message {
		t.Errorf("message mismatch: expected %s, got %s", errResp.Message, decoded.Message)
	}
}
