package config

import (
	"encoding/json"
	"fmt"
	"os"
)

// StringOrStringArray handles JSON fields that can be either a string or array of strings
type StringOrStringArray []string

// UnmarshalJSON implements json.Unmarshaler
func (s *StringOrStringArray) UnmarshalJSON(data []byte) error {
	// Try as string first
	var str string
	if err := json.Unmarshal(data, &str); err == nil {
		*s = []string{str}
		return nil
	}

	// Try as array
	var arr []string
	if err := json.Unmarshal(data, &arr); err != nil {
		return err
	}
	*s = arr
	return nil
}

// DevcontainerConfig holds the parsed devcontainer configuration
type DevcontainerConfig struct {
	Image                *string              `json:"image,omitempty"`
	DockerFile           *string              `json:"dockerFile,omitempty"`
	Features             map[string]any       `json:"features,omitempty"`
	OnCreateCommand      *StringOrStringArray `json:"onCreateCommand,omitempty"`
	UpdateContentCommand *StringOrStringArray `json:"updateContentCommand,omitempty"`
	PostCreateCommand    *StringOrStringArray `json:"postCreateCommand,omitempty"`
	PostStartCommand     *StringOrStringArray `json:"postStartCommand,omitempty"`
	WorkspaceFolder      *string              `json:"workspaceFolder,omitempty"`
	Extensions           []string             `json:"extensions,omitempty"`
}

// ParseDevcontainer parses a devcontainer.json file and returns the configuration
func ParseDevcontainer(path string) (*DevcontainerConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read devcontainer file: %w", err)
	}

	var cfg DevcontainerConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("failed to parse devcontainer JSON: %w", err)
	}

	return &cfg, nil
}
