// Package grpc provides the gRPC server for command execution
package grpc

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"os/exec"
	"sync"
	"time"

	"github.com/codepod/codepod/sandbox/agent/pkg/grpc/pb"
	"google.golang.org/grpc"
	"google.golang.org/grpc/keepalive"
	"google.golang.org/grpc/metadata"
)

// Server represents the gRPC execution server
type Server struct {
	pb.UnimplementedExecServiceServer
	port   int
	token  string
}

// NewServer creates a new gRPC server
func NewServer(port int, token string) *Server {
	return &Server{
		port:  port,
		token: token,
	}
}

// Start starts the gRPC server
func (s *Server) Start(ctx context.Context) error {
	addr := fmt.Sprintf(":%d", s.port)
	lis, err := CreateListener(addr)
	if err != nil {
		return fmt.Errorf("failed to create listener: %w", err)
	}

	// Configure gRPC server with keepalive
	grpcServer := grpc.NewServer(
		grpc.KeepaliveParams(keepalive.ServerParameters{
			Time:    30 * time.Second,    // send keepalive every 30s
			Timeout: 10 * time.Second,    // timeout for keepalive response
		}),
		grpc.StreamInterceptor(s.authStreamInterceptor),
	)

	pb.RegisterExecServiceServer(grpcServer, s)

	log.Printf("gRPC server listening on %s", addr)

	go func() {
		if err := grpcServer.Serve(lis); err != nil && ctx.Err() == nil {
			log.Printf("gRPC server error: %v", err)
		}
	}()

	go func() {
		<-ctx.Done()
		grpcServer.GracefulStop()
	}()

	return nil
}

// CreateListener creates a TCP listener with retry logic
func CreateListener(addr string) (net.Listener, error) {
	var ln net.Listener
	var err error
	for i := 0; i < 5; i++ {
		ln, err = net.Listen("tcp", addr)
		if err == nil {
			return ln, nil
		}
		if i < 4 {
			time.Sleep(100 * time.Millisecond)
		}
	}
	return nil, err
}

// authStreamInterceptor validates the token from metadata
func (s *Server) authStreamInterceptor(srv interface{}, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
	if err := s.validateToken(ss.Context()); err != nil {
		return err
	}
	return handler(srv, ss)
}

// validateToken validates the token from gRPC metadata
func (s *Server) validateToken(ctx context.Context) error {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return fmt.Errorf("missing metadata")
	}

	tokens := md.Get("token")
	if len(tokens) == 0 {
		return fmt.Errorf("missing token")
	}

	if tokens[0] != s.token {
		return fmt.Errorf("invalid token")
	}

	return nil
}

// OpenSession opens an execution session for multiplexing.
// This allows a single connection to execute multiple commands.
func (s *Server) OpenSession(req *pb.OpenSessionRequest, stream pb.ExecService_OpenSessionServer) error {
	log.Printf("OpenSession: sandbox_id=%s", req.SandboxId)

	// Send welcome message
	if err := stream.Send(&pb.CommandOutput{
		Line:    "Session opened",
		Channel: pb.OutputChannel_STDOUT,
	}); err != nil {
		return err
	}

	// Keep the session open until the client disconnects
	// The client can send ExecuteRequests through the stream
	// For now, we'll just wait for the context to be cancelled
	<-stream.Context().Done()

	log.Printf("OpenSession closed: sandbox_id=%s", req.SandboxId)
	return nil
}

// Execute executes a command and streams the output
func (s *Server) Execute(req *pb.ExecuteRequest, stream pb.ExecService_ExecuteServer) error {
	log.Printf("Execute: command=%s, cwd=%s, timeout=%d", req.Command, req.Cwd, req.Timeout)

	// Build the command
	cmd := exec.Command("sh", "-c", req.Command)

	// Set working directory
	if req.Cwd != "" {
		cmd.Dir = req.Cwd
	}

	// Set environment variables
	if len(req.Env) > 0 {
		for k, v := range req.Env {
			cmd.Env = append(cmd.Env, fmt.Sprintf("%s=%s", k, v))
		}
	}

	// Also inherit current environment
	cmd.Env = append(cmd.Env, os.Environ()...)

	// Create pipes for stdout and stderr
	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	// Start the command
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start command: %w", err)
	}

	// Create context with timeout if specified
	ctx := stream.Context()
	if req.Timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, time.Duration(req.Timeout)*time.Millisecond)
		defer cancel()
	}

	// Use waitgroup to coordinate goroutines
	var wg sync.WaitGroup
	errChan := make(chan error, 1)

	// Stream stdout
	wg.Add(1)
	go func() {
		defer wg.Done()
		err := streamOutput(bufio.NewReader(stdoutPipe), stream, pb.OutputChannel_STDOUT)
		if err != nil {
			select {
			case errChan <- err:
			default:
			}
		}
	}()

	// Stream stderr
	wg.Add(1)
	go func() {
		defer wg.Done()
		err := streamOutput(bufio.NewReader(stderrPipe), stream, pb.OutputChannel_STDERR)
		if err != nil {
			select {
			case errChan <- err:
			default:
			}
		}
	}()

	// Wait for command to complete and close pipes
	// Use context to properly terminate goroutine if context is cancelled
	cmdCtx, cmdCancel := context.WithCancel(ctx)
	go func() {
		defer cmdCancel()
		cmd.Wait()
		stdoutPipe.Close()
		stderrPipe.Close()
	}()

	// Ensure command is cleaned up when context is cancelled
	defer func() {
		if cmdCtx.Err() != nil && cmd.Process != nil {
			cmd.Process.Kill()
		}
	}()

	// Wait for all streaming to complete or context cancellation
	doneChan := make(chan struct{})
	go func() {
		wg.Wait()
		close(doneChan)
	}()

	// Check for errors or context cancellation
	select {
	case <-doneChan:
		// Streaming completed normally
	case err := <-errChan:
		if err != nil && err != io.EOF {
			// Only kill if process is still running
			if cmd.Process != nil {
				cmd.Process.Kill()
			}
			return err
		}
	case <-ctx.Done():
		// Only kill if process is still running
		if cmd.Process != nil {
			cmd.Process.Kill()
		}
		return ctx.Err()
	}

	// Wait for command to fully exit (ignore error as process may already be done)
	// Check if Process is nil to avoid panic
	if cmd.Process != nil {
		cmd.Wait()
	}

	// Get exit code
	exitCode := int32(0)
	if cmd.ProcessState != nil {
		exitCode = int32(cmd.ProcessState.ExitCode())
	}

	// Send final message with exit code
	if err := stream.Send(&pb.CommandOutput{
		Line:     "",
		Channel:  pb.OutputChannel_STDOUT,
		End:      true,
		ExitCode: exitCode,
	}); err != nil {
		return err
	}

	log.Printf("Execute completed: command=%s, exit_code=%d", req.Command, exitCode)
	return nil
}

// streamOutput reads from the reader and streams to the client
func streamOutput(reader *bufio.Reader, stream pb.ExecService_ExecuteServer, channel pb.OutputChannel) error {
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			if err == io.EOF {
				return nil
			}
			return err
		}

		// Remove trailing newline
		if len(line) > 0 && line[len(line)-1] == '\n' {
			line = line[:len(line)-1]
		}

		if err := stream.Send(&pb.CommandOutput{
			Line:    line,
			Channel: channel,
		}); err != nil {
			return err
		}
	}
}
