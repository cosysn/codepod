// apps/agent/cmd/main.go
package main

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/codepod/codepod/sandbox/agent/pkg/config"
	"github.com/codepod/codepod/sandbox/agent/pkg/grpc"
	"github.com/codepod/codepod/sandbox/agent/pkg/reporter"
	"github.com/codepod/codepod/sandbox/agent/pkg/ssh"
	sshc "golang.org/x/crypto/ssh"
)

// generateSSHHostKeys generates SSH host keys using Go crypto library
func generateSSHHostKeys() error {
	keyPath := "/etc/ssh/ssh_host_rsa_key"
	if _, err := os.Stat(keyPath); os.IsNotExist(err) {
		log.Println("Generating SSH host keys...")

		// Ensure /etc/ssh directory exists
		if err := os.MkdirAll("/etc/ssh", 0755); err != nil {
			return err
		}

		// Generate RSA key using Go crypto library (self-contained)
		privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
		if err != nil {
			return fmt.Errorf("failed to generate RSA key: %w", err)
		}

		// Write private key
		privateKeyBytes := x509.MarshalPKCS1PrivateKey(privateKey)
		privateKeyPEM := pem.Block{
			Type:  "RSA PRIVATE KEY",
			Bytes: privateKeyBytes,
		}
		if err := os.WriteFile(keyPath, pem.EncodeToMemory(&privateKeyPEM), 0600); err != nil {
			return fmt.Errorf("failed to write private key: %w", err)
		}

		// Also generate public key file for ssh-keygen compatibility
		sshPublicKey, err := sshc.NewPublicKey(&privateKey.PublicKey)
		if err != nil {
			return fmt.Errorf("failed to generate SSH public key: %w", err)
		}
		if err := os.WriteFile(keyPath+".pub", sshc.MarshalAuthorizedKey(sshPublicKey), 0644); err != nil {
			return fmt.Errorf("failed to write public key: %w", err)
		}

		log.Println("SSH host keys generated using Go crypto library")
	}
	return nil
}

func main() {
	log.Println("Starting CodePod Agent...")

	// Generate SSH host keys if needed
	if err := generateSSHHostKeys(); err != nil {
		log.Printf("Warning: failed to generate SSH host keys: %v", err)
	}

	cfg := config.LoadFromEnv()

	if err := cfg.Validate(); err != nil {
		log.Fatalf("Invalid configuration: %v", err)
	}

	log.Printf("Sandbox ID: %s", cfg.Agent.SandboxID)

	// Create reporter client
	reporterCfg := &reporter.Config{
		ServerURL: cfg.Agent.ServerURL,
		SandboxID: cfg.Agent.SandboxID,
		Interval:  30 * time.Second, // Default 30s
	}
	reporterClient := reporter.NewClient(reporterCfg)

	server := ssh.NewServer(&ssh.ServerConfig{
		Port:              cfg.SSH.Port,
		HostKeys:          cfg.SSH.HostKeys,
		MaxSessions:       cfg.SSH.MaxSessions,
		IdleTimeout:       cfg.SSH.IdleTimeout,
		Token:             cfg.Agent.Token,
		TrustedUserCAKeys: cfg.SSH.TrustedUserCAKeys,
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start reporter heartbeat in background
	initialStatus := &reporter.Status{
		Status:    "running",
		Hostname: getHostname(),
	}
	go func() {
		if err := reporterClient.StartHeartbeat(ctx, initialStatus); err != nil && ctx.Err() == nil {
			log.Printf("Reporter error: %v", err)
		}
	}()

	// Start gRPC server for command execution in a goroutine
	// (must start before SSH server since SSH server blocks in Accept())
	grpcServer := grpc.NewServer(cfg.GRPC.Port, cfg.Agent.Token)
	if err := grpcServer.Start(ctx); err != nil {
		log.Fatalf("Failed to start gRPC server: %v", err)
	}

	// Start SSH server (this blocks forever accepting connections)
	if err := server.Start(ctx); err != nil {
		log.Fatalf("Failed to start SSH server: %v", err)
	}

	// Handle shutdown signals
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	cancel()
	log.Println("Shutting down...")
	server.Stop()
}

func getHostname() string {
	hostname, err := os.Hostname()
	if err != nil {
		return "unknown"
	}
	return hostname
}
