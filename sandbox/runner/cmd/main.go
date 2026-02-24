package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/codepod/codepod/sandbox/runner/internal/runner"
)

// Version is set at build time via ldflags
var Version = "v0.0.0-dev"

func main() {
	flag.Bool("version", false, "Show version")
	flag.Bool("v", false, "Show version (shorthand)")
	flag.Parse()

	if flag.Lookup("version").Value.String() == "true" || flag.Lookup("v").Value.String() == "true" {
		fmt.Println(Version)
		os.Exit(0)
	}

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
