// apps/agent/cmd/main.go
package main

import (
	"context"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"syscall"
	"time"

	"github.com/codepod/codepod/sandbox/agent/pkg/config"
	"github.com/codepod/codepod/sandbox/agent/pkg/reporter"
	"github.com/codepod/codepod/sandbox/agent/pkg/ssh"
)

// generateSSHHostKeys generates SSH host keys if they don't exist
func generateSSHHostKeys() error {
	keyPath := "/etc/ssh/ssh_host_rsa_key"
	if _, err := os.Stat(keyPath); os.IsNotExist(err) {
		log.Println("Generating SSH host keys...")

		// Ensure /etc/ssh directory exists
		if err := os.MkdirAll("/etc/ssh", 0755); err != nil {
			return err
		}

		// Generate RSA key
		if err := exec.Command("ssh-keygen", "-A").Run(); err != nil {
			return err
		}
		log.Println("SSH host keys generated")
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
