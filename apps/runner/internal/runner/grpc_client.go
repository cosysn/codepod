package runner

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// GrpcClientConfig holds the configuration for the gRPC client
type GrpcClientConfig struct {
	ServerURL string
	RunnerID  string
	Capacity  int
}

// GrpcClient manages the gRPC connection to the server
type GrpcClient struct {
	conn   *grpc.ClientConn
	config *GrpcClientConfig
}

// NewGrpcClient creates a new gRPC client connection to the server
func NewGrpcClient(config *GrpcClientConfig) (*GrpcClient, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, err := grpc.DialContext(
		ctx,
		config.ServerURL,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithBlock(),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to server: %w", err)
	}

	return &GrpcClient{
		conn:   conn,
		config: config,
	}, nil
}

// Close closes the gRPC connection
func (c *GrpcClient) Close() error {
	return c.conn.Close()
}

// GetConn returns the underlying gRPC connection
func (c *GrpcClient) GetConn() *grpc.ClientConn {
	return c.conn
}

// GetConfig returns the client configuration
func (c *GrpcClient) GetConfig() *GrpcClientConfig {
	return c.config
}

// Register registers the runner with the server via HTTP
func (c *GrpcClient) Register(ctx context.Context) error {
	// Register via HTTP for now
	url := fmt.Sprintf("%s/api/v1/runners/register", c.config.ServerURL)

	// Use HTTP client
	body := fmt.Sprintf(`{"id":"%s","capacity":%d}`, c.config.RunnerID, c.config.Capacity)
	req, err := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("registration failed: %d", resp.StatusCode)
	}

	fmt.Printf("Runner %s registered successfully\n", c.config.RunnerID)
	return nil
}
