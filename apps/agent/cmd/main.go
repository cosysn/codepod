// apps/agent/cmd/main.go
package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/codepod/codepod/apps/agent/pkg/config"
	"github.com/codepod/codepod/apps/agent/pkg/ssh"
)

func main() {
	log.Println("Starting CodePod Agent...")

	cfg := config.LoadFromEnv()

	if err := cfg.Validate(); err != nil {
		log.Fatalf("Invalid configuration: %v", err)
	}

	log.Printf("Sandbox ID: %s", cfg.Agent.SandboxID)

	server := ssh.NewServer(&ssh.ServerConfig{
		Port:        cfg.SSH.Port,
		HostKeys:    cfg.SSH.HostKeys,
		MaxSessions: cfg.SSH.MaxSessions,
		IdleTimeout: cfg.SSH.IdleTimeout,
		Token:       cfg.Agent.Token,
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

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
