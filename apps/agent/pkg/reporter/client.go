package reporter

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/shirou/gopsutil/host"
	"github.com/shirou/gopsutil/mem"
)

// Config holds the configuration for the reporter client.
type Config struct {
	ServerURL string        // Server URL (e.g., "http://server:8080")
	SandboxID string        // The sandbox identifier
	Interval  time.Duration // Heartbeat interval (default 30s)
}

// Status represents the status report sent to the server.
type Status struct {
	SandboxID    string            `json:"sandboxId"`
	Status       string            `json:"status"`
	CPUPercent   float64           `json:"cpuPercent,omitempty"`
	MemoryMB     int               `json:"memoryMB,omitempty"`
	SessionCount int               `json:"sessionCount,omitempty"`
	UptimeSecs   int64             `json:"uptimeSecs"`
	Hostname     string            `json:"hostname"`
	Timestamp    time.Time         `json:"timestamp"`
	Metadata     map[string]string `json:"metadata,omitempty"`
}

// Client is the reporter client that sends heartbeat/status updates to the server.
type Client struct {
	config *Config
	client *http.Client
}

// NewClient creates a new Reporter client with the given configuration.
func NewClient(cfg *Config) *Client {
	if cfg.Interval == 0 {
		cfg.Interval = 30 * time.Second
	}
	return &Client{
		config: cfg,
		client: &http.Client{Timeout: 10 * time.Second},
	}
}

// Report sends a single status update to the server.
func (c *Client) Report(ctx context.Context, status *Status) error {
	status.SandboxID = c.config.SandboxID
	status.Timestamp = time.Now()

	data, err := json.Marshal(status)
	if err != nil {
		return fmt.Errorf("failed to marshal: %w", err)
	}

	url := fmt.Sprintf("%s/api/v1/sandboxes/%s/status", c.config.ServerURL, c.config.SandboxID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("server returned %d", resp.StatusCode)
	}
	return nil
}

// StartHeartbeat starts periodic heartbeat updates to the server.
func (c *Client) StartHeartbeat(ctx context.Context, initialStatus *Status) error {
	// Send initial status
	if err := c.Report(ctx, initialStatus); err != nil {
		fmt.Printf("Initial status failed: %v\n", err)
	}

	ticker := time.NewTicker(c.config.Interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			// Send final status
			final := *initialStatus
			final.Status = "stopped"
			c.Report(context.Background(), &final)
			return nil
		case <-ticker.C:
			status := c.collectStatus(initialStatus)
			if err := c.Report(ctx, status); err != nil {
				fmt.Printf("Heartbeat failed: %v\n", err)
			}
		}
	}
}

// collectStatus collects the current status for heartbeat.
func (c *Client) collectStatus(base *Status) *Status {
	// Get uptime
	uptime, _ := host.Uptime()

	// Get memory
	v, _ := mem.VirtualMemory()

	return &Status{
		Status:      "running",
		Hostname:   base.Hostname,
		UptimeSecs: int64(uptime),
		MemoryMB:   int(v.Used / 1024 / 1024),
		CPUPercent: 0, // Requires interval for accurate reading
		SessionCount: base.SessionCount,
	}
}
