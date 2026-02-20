package main

import (
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/codepod/codepod/apps/runner/internal/runner"
)

func main() {
	log.Println("Starting CodePod Runner...")

	r, err := runner.New()
	if err != nil {
		log.Fatalf("Failed to create runner: %v", err)
	}

	// Handle shutdown signals
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-sigChan
		log.Println("Shutdown signal received, stopping runner...")
		r.Stop()
		os.Exit(0)
	}()

	fmt.Println("Runner started successfully")
	r.Run()
}
