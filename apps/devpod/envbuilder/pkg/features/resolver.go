package features

import (
	"fmt"
	"io"
	"net/http"
	"strings"
)

type Resolver struct {
	featuresBaseURL string
}

func NewResolver() *Resolver {
	return &Resolver{
		featuresBaseURL: "https://raw.githubusercontent.com/devcontainers/features/main/src",
	}
}

func (r *Resolver) Resolve(feature string, options map[string]any) (string, error) {
	// Parse feature: ghcr.io/devcontainers/features/go:1 -> src/go
	parts := strings.Split(feature, ":")
	if len(parts) < 2 {
		return "", fmt.Errorf("invalid feature format: %s", feature)
	}

	featurePath := strings.TrimPrefix(parts[0], "ghcr.io/devcontainers/features/")
	featureName := featurePath

	// Construct URL to install.sh
	url := fmt.Sprintf("%s/%s/install.sh", r.featuresBaseURL, featureName)

	// Download script
	resp, err := http.Get(url)
	if err != nil {
		return "", fmt.Errorf("failed to fetch feature: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("feature not found: %s (status: %d)", feature, resp.StatusCode)
	}

	script, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read script: %w", err)
	}

	return string(script), nil
}

func (r *Resolver) ResolveAll(features map[string]any) (map[string]string, error) {
	result := make(map[string]string)

	for feature, options := range features {
		script, err := r.Resolve(feature, options.(map[string]any))
		if err != nil {
			return nil, err
		}
		result[feature] = script
	}

	return result, nil
}
