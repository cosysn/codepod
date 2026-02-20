package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/codepod/codepod/libs/sdk-go/types"
)

func TestCreateSandbox(t *testing.T) {
	expected := types.CreateSandboxResponse{
		Sandbox: &types.Sandbox{
			ID:     "sbox-123",
			Name:   "test",
			Status: types.SandboxStatusRunning,
			Image:  "python:3.11",
		},
		SSHHost: "localhost",
		SSHPort: 2222,
		SSHUser: "root",
		Token:   "test-token",
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if r.URL.Path != "/api/v1/sandboxes" {
			t.Errorf("expected /api/v1/sandboxes, got %s", r.URL.Path)
		}
		if r.Header.Get("X-API-Key") != "test-key" {
			t.Errorf("expected X-API-Key header, got %s", r.Header.Get("X-API-Key"))
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(expected)
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-key")
	resp, err := client.CreateSandbox(context.Background(), &types.CreateSandboxRequest{
		Name:  "test",
		Image: "python:3.11",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if resp.Sandbox.ID != expected.Sandbox.ID {
		t.Errorf("expected sandbox ID %s, got %s", expected.Sandbox.ID, resp.Sandbox.ID)
	}
	if resp.Token != expected.Token {
		t.Errorf("expected token %s, got %s", expected.Token, resp.Token)
	}
}

func TestGetSandbox(t *testing.T) {
	expected := types.SandboxInfo{
		ID:        "sbox-123",
		Name:      "test",
		Status:    types.SandboxStatusRunning,
		Image:     "python:3.11",
		Host:      "localhost",
		Port:      2222,
		CreatedAt: time.Now(),
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET, got %s", r.Method)
		}
		if r.URL.Path != "/api/v1/sandboxes/sbox-123" {
			t.Errorf("expected /api/v1/sandboxes/sbox-123, got %s", r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(expected)
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-key")
	resp, err := client.GetSandbox(context.Background(), "sbox-123")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if resp.ID != expected.ID {
		t.Errorf("expected ID %s, got %s", expected.ID, resp.ID)
	}
}

func TestGetSandboxNotFound(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-key")
	resp, err := client.GetSandbox(context.Background(), "not-found")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp != nil {
		t.Errorf("expected nil response for not found")
	}
}

func TestListSandboxes(t *testing.T) {
	expected := struct {
		Sandboxes []*types.SandboxInfo `json:"sandboxes"`
		Total     int                  `json:"total"`
	}{
		Sandboxes: []*types.SandboxInfo{
			{ID: "sbox-1", Name: "test1", Status: types.SandboxStatusRunning},
			{ID: "sbox-2", Name: "test2", Status: types.SandboxStatusStopped},
		},
		Total: 2,
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET, got %s", r.Method)
		}
		if r.URL.Path != "/api/v1/sandboxes" {
			t.Errorf("expected /api/v1/sandboxes, got %s", r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(expected)
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-key")
	sandboxes, err := client.ListSandboxes(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(sandboxes) != 2 {
		t.Errorf("expected 2 sandboxes, got %d", len(sandboxes))
	}
}

func TestDeleteSandbox(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			t.Errorf("expected DELETE, got %s", r.Method)
		}
		if r.URL.Path != "/api/v1/sandboxes/sbox-123" {
			t.Errorf("expected /api/v1/sandboxes/sbox-123, got %s", r.URL.Path)
		}

		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-key")
	err := client.DeleteSandbox(context.Background(), "sbox-123")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestDeleteSandboxNotFound(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-key")
	err := client.DeleteSandbox(context.Background(), "not-found")
	if err == nil {
		t.Errorf("expected error for not found")
	}
}

func TestGetConnectionToken(t *testing.T) {
	expected := struct {
		Token string `json:"token"`
	}{
		Token: "connection-token-123",
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if r.URL.Path != "/api/v1/sandboxes/sbox-123/token" {
			t.Errorf("expected /api/v1/sandboxes/sbox-123/token, got %s", r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(expected)
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-key")
	token, err := client.GetConnectionToken(context.Background(), "sbox-123")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if token != expected.Token {
		t.Errorf("expected token %s, got %s", expected.Token, token)
	}
}

func TestClientTimeout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(2 * time.Second)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-key")
	client.http.Timeout = 100 * time.Millisecond

	_, err := client.GetSandbox(context.Background(), "test")
	if err == nil {
		t.Errorf("expected timeout error")
	}
}
