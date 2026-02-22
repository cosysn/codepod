package features

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
)

type Resolver struct {
	featuresBaseURL string
	httpClient      *http.Client
}

func NewResolver() *Resolver {
	return &Resolver{
		featuresBaseURL: "https://raw.githubusercontent.com/devcontainers/features/main/src",
		httpClient:      http.DefaultClient,
	}
}

func NewResolverWithBaseURL(baseURL string) *Resolver {
	return &Resolver{
		featuresBaseURL: baseURL,
		httpClient:      http.DefaultClient,
	}
}

func NewResolverWithOptions(baseURL string, httpClient *http.Client) *Resolver {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &Resolver{
		featuresBaseURL: baseURL,
		httpClient:      httpClient,
	}
}

func (r *Resolver) Resolve(ctx context.Context, feature string, options map[string]any) (string, error) {
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
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := r.httpClient.Do(req)
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

	// If options are provided, inject them as environment variables into the script
	if len(options) > 0 {
		script = r.injectOptions(script, options)
	}

	return string(script), nil
}

// injectOptions adds options as environment variables at the beginning of the script
func (r *Resolver) injectOptions(script []byte, options map[string]any) []byte {
	var envVars strings.Builder
	for key, value := range options {
		envValue := fmt.Sprintf("%v", value)
		envVars.WriteString(fmt.Sprintf("export %s=%q\n", key, envValue))
	}

	return []byte(envVars.String() + string(script))
}

func (r *Resolver) ResolveAll(ctx context.Context, features map[string]any) (map[string]string, error) {
	result := make(map[string]string)

	for feature, options := range features {
		// Safe type assertion for options
		opts, ok := options.(map[string]any)
		if !ok {
			opts = make(map[string]any)
		}

		script, err := r.Resolve(ctx, feature, opts)
		if err != nil {
			return nil, err
		}
		result[feature] = script
	}

	return result, nil
}

// SetHTTPClient allows replacing the default HTTP client
func (r *Resolver) SetHTTPClient(client *http.Client) {
	if client != nil {
		r.httpClient = client
	}
}

// SetBaseURL allows replacing the default base URL
func (r *Resolver) SetBaseURL(baseURL string) {
	if baseURL != "" {
		r.featuresBaseURL = baseURL
	}
}
