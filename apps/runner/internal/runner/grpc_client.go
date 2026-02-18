package runner

import (
	"context"
	"fmt"
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

// Register registers the runner with the server
func (c *GrpcClient) Register(ctx context.Context) error {
	// Simplified: HTTP fallback for now
	// In real implementation, this would register with the gRPC server
	fmt.Printf("Registering runner %s with server at %s\n", c.config.RunnerID, c.config.ServerURL)
	return nil
}
