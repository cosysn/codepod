package config

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
