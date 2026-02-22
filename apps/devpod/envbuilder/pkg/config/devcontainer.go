package config

import (
	"encoding/json"
	"os"
)

// DevcontainerJSON represents the structure of a .devcontainer.json file
type DevcontainerJSON struct {
	Image           string            `json:"image,omitempty"`
	Build           *BuildConfig      `json:"build,omitempty"`
	Features        map[string]any    `json:"features,omitempty"`
	Customizations  *Customizations   `json:"customizations,omitempty"`
}

// BuildConfig contains build-specific configuration
type BuildConfig struct {
	Dockerfile string            `json:"dockerfile,omitempty"`
	Context    string            `json:"context,omitempty"`
	Args       map[string]string `json:"args,omitempty"`
}

// Customizations contains IDE customizations
type Customizations struct {
	Vscode map[string]any `json:"vscode,omitempty"`
}

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
	Image                *string               `json:"image,omitempty"`
	DockerFile           *string               `json:"dockerFile,omitempty"`
	Features             map[string]any        `json:"features,omitempty"`
	OnCreateCommand     *StringOrStringArray  `json:"onCreateCommand,omitempty"`
	UpdateContentCommand *StringOrStringArray  `json:"updateContentCommand,omitempty"`
	PostCreateCommand   *StringOrStringArray  `json:"postCreateCommand,omitempty"`
	PostStartCommand    *StringOrStringArray  `json:"postStartCommand,omitempty"`
	WorkspaceFolder     *string               `json:"workspaceFolder,omitempty"`
	Extensions          []string              `json:"extensions,omitempty"`
}

// ParseDevcontainer parses a devcontainer.json file and returns the configuration
func ParseDevcontainer(path string) (*DevcontainerConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var cfg DevcontainerConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}

	return &cfg, nil
}
