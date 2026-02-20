package ssh

import (
	"testing"
)

func TestNewServer(t *testing.T) {
	cfg := &ServerConfig{
		Port:     2222,
		HostKeys: []string{"/tmp/test_key"},
		Token:    "test-token",
	}

	server := NewServer(cfg)
	if server == nil {
		t.Fatal("Expected non-nil server")
	}

	if server.config.Port != 2222 {
		t.Errorf("Expected port 2222, got %d", server.config.Port)
	}

	if server.config.Token != "test-token" {
		t.Errorf("Expected token 'test-token', got '%s'", server.config.Token)
	}
}

func TestServerConfig(t *testing.T) {
	tests := []struct {
		name     string
		config   ServerConfig
		expected int
	}{
		{
			name: "default port 22",
			config: ServerConfig{
				Port: 22,
			},
			expected: 22,
		},
		{
			name: "custom port 2222",
			config: ServerConfig{
				Port: 2222,
			},
			expected: 2222,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.config.Port != tt.expected {
				t.Errorf("Expected port %d, got %d", tt.expected, tt.config.Port)
			}
		})
	}
}

func TestAuthenticate(t *testing.T) {
	tests := []struct {
		name     string
		token    string
		password string
		expected bool
	}{
		{
			name:     "valid token",
			token:    "correct-token",
			password: "correct-token",
			expected: true,
		},
		{
			name:     "invalid token",
			token:    "correct-token",
			password: "wrong-token",
			expected: false,
		},
		{
			name:     "empty token",
			token:    "",
			password: "",
			expected: true,
		},
		{
			name:     "empty password with empty token",
			token:    "secret",
			password: "",
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			auth := &serverPasswordAuth{token: tt.token}
			_, err := auth.Authenticate(nil, []byte(tt.password))
			if tt.expected && err != nil {
				t.Errorf("Expected authentication to succeed, got error: %v", err)
			}
			if !tt.expected && err == nil {
				t.Errorf("Expected authentication to fail, but it succeeded")
			}
		})
	}
}
