// apps/agent/cmd/main.go
package main

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"flag"
	"fmt"
	"log"
	"net"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/codepod/codepod/sandbox/agent/pkg/config"
	"github.com/codepod/codepod/sandbox/agent/pkg/grpc"
	"github.com/codepod/codepod/sandbox/agent/pkg/multiplex"
	"github.com/codepod/codepod/sandbox/agent/pkg/reporter"
	"github.com/codepod/codepod/sandbox/agent/pkg/ssh"
	sshc "golang.org/x/crypto/ssh"
)

// Version is set at build time via ldflags
var Version = "v0.0.0-dev"

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
	flag.Bool("version", false, "Show version")
	flag.Bool("v", false, "Show version (shorthand)")
	flag.Parse()

	if flag.Lookup("version").Value.String() == "true" || flag.Lookup("v").Value.String() == "true" {
		fmt.Println(Version)
		os.Exit(0)
	}

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
	log.Printf("Agent Token: %s (length: %d)", cfg.Agent.Token, len(cfg.Agent.Token))

	// Create reporter client
	reporterCfg := &reporter.Config{
		ServerURL: cfg.Agent.ServerURL,
		SandboxID: cfg.Agent.SandboxID,
		Interval:  30 * time.Second, // Default 30s
	}
	reporterClient := reporter.NewClient(reporterCfg)

	// Create SSH server config (port is not used when using StartWithListener)
	sshServer := ssh.NewServer(&ssh.ServerConfig{
		Port:              cfg.SSH.Port,
		HostKeys:          cfg.SSH.HostKeys,
		MaxSessions:       cfg.SSH.MaxSessions,
		IdleTimeout:       cfg.SSH.IdleTimeout,
		Token:             cfg.Agent.Token,
		TrustedUserCAKeys: cfg.SSH.TrustedUserCAKeys,
	})

	// Create gRPC server
	grpcServer := grpc.NewServer(cfg.GRPC.Port, cfg.Agent.Token)

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

	// Create multiplex server with SSH and gRPC handlers
	multiplexAddr := fmt.Sprintf(":%d", cfg.Multiplex.Port)
	multiplexServer := multiplex.New(
		multiplexAddr,
		// SSH handler
		func(listener net.Listener) error {
			return sshServer.StartWithListener(ctx, listener)
		},
		// gRPC handler
		func(listener net.Listener) error {
			return grpcServer.StartWithListener(ctx, listener)
		},
	)

	log.Printf("Starting multiplexed server on port %d (SSH + gRPC)", cfg.Multiplex.Port)

	// Start multiplexed server in goroutine
	go func() {
		if err := multiplexServer.Start(); err != nil {
			log.Fatalf("Failed to start multiplexed server: %v", err)
		}
	}()

	// Handle shutdown signals
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	log.Println("Shutting down...")

	// Stop the multiplex server gracefully
	multiplexServer.Stop()

	// Stop SSH server
	sshServer.Stop()

	// Cancel context to stop all background operations
	cancel()
}

func getHostname() string {
	hostname, err := os.Hostname()
	if err != nil {
		return "unknown"
	}
	return hostname
}
