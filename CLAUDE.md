# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CodePod is a secure sandbox platform for isolated development environments and AI Agent execution. It provides Docker-based sandboxes with SSH access, multiple language runtimes (Python, Node.js, Go), and multi-language SDKs.

## Development Commands

```bash
# Install dependencies (run from project root)
go work sync          # Go workspace dependencies
go mod download       # Download Go modules
npm install          # Node.js dependencies

# Build all components
make build

# Build individual components
make build-agent     # Builds amd64 and arm64 binaries
make build-runner
make build-server
make build-cli
make build-sdk

# Development mode (run source directly)
make dev-server      # cd apps/server && npm run dev
make dev-cli        # cd apps/cli && npm run dev
# Go components: cd apps/{agent,runner} && go run ./cmd

# Run all tests
make test

# Test individual components
make test-agent
make test-runner
make test-server
make test-cli

# Run tests for a single component
cd apps/agent && go test ./...
cd apps/runner && go test ./...
cd apps/server && npm test
cd apps/cli && npm test

# Docker development (Server runs on port 8080, gRPC on 50051)
cd docker && docker-compose up -d

# Check build status
make status
```

## Go Workspace

This project uses `go.work` to manage multi-module dependencies:
- Agent and Runner are in the workspace
- SDK is referenced via `replace` directive for local development
- Run `go work sync` after adding new dependencies

## Linting and Formatting

- **Go**: `go fmt ./...` and `golangci-lint run ./...`
- **TypeScript**: ESLint and Prettier configured in each app

## Configuration

- **CLI config**: `~/.codepod/config.json` (endpoint, API key)
- **Server config**: Environment variables or `apps/server/.env`
- **Build output**: `build/` directory contains all compiled binaries
- **Docker data**: `docker/data/` for persistent volumes (SQLite)

## Architecture

### Three-Layer Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Control Plane (CLI/SDK ──HTTP──► Server)                       │
│   - CLI: TypeScript (commander.js + inquirer.js)               │
│   - SDK: Go, Python, TypeScript                                │
│   - Server: Express.js + gRPC Server (port 50051)              │
└─────────────────────────────────────────────────────────────────┘
                              │
                        gRPC (mTLS)
                              │
┌─────────────────────────────────────────────────────────────────┐
│ Orchestration Plane (Server ◄──gRPC──► Runner Pool)            │
│   - Server manages Runner registry and job scheduling           │
│   - Runners connect to Server (reverse tunnel for NAT/firewall) │
│   - Runner: Go with Docker SDK                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
               gRPC / HTTP (Agent communication)
                              │
┌─────────────────────────────────────────────────────────────────┐
│ Sandbox Plane (Runner ──Docker──► Sandbox Container)            │
│   - Agent: Go SSH Server (PID 1 in container)                  │
│   - Provides shell access, command execution, port forwarding    │
└─────────────────────────────────────────────────────────────────┘
```

### Key Communication Patterns

| Path | Protocol | Authentication |
|------|----------|----------------|
| CLI/SDK → Server | REST API (port 8080) | API Key |
| Server → Runner | gRPC (port 50051, mTLS) | Runner Token |
| User → Agent | SSH | Temporary Token |
| Agent → Runner | HTTP | Agent Token |

### Runner Connection Model

**Critical**: Runners may be behind NAT/firewalls. Server cannot connect to Runners directly. Instead:
- Server runs as gRPC Server (port 50051)
- Runners actively connect to Server (reverse tunnel)
- Server pushes jobs through this established connection

## Core Subsystems

### Agent (apps/agent/)
- **Purpose**: SSH Server running as PID 1 in each Sandbox container (handles signal forwarding, zombie reaping)
- **Key modules**:
  - `pkg/ssh/`: SSH server, session management, PTY
  - `pkg/exec/`: Command executor (shell and direct modes)
  - `pkg/process/`: Process management, zombie reaping, signal forwarding
  - `pkg/tunnel/`: Local/remote/dynamic port forwarding
  - `pkg/reporter/`: Heartbeat and status reporting to Runner
- **Authentication**: Token (from API), public key (optional), password (disabled by default)

### Runner (apps/runner/)
- **Purpose**: Sandbox lifecycle management, Docker operations, job scheduling
- **Key modules**:
  - `pkg/scheduler/`: Job queue management, priority scheduling, retry policies
  - `pkg/docker/`: Container/image/network management
  - `pkg/sandbox/`: Sandbox creation/deletion with Agent injection
  - `pkg/storage/`: Volume and snapshot management

### Server (apps/server/)
- **Purpose**: REST API, Runner registry, resource quotas, webhooks, audit logs
- **Key modules**:
  - `src/routes/`: REST endpoints for sandboxes, API keys, webhooks
  - `src/services/`: Business logic services
  - `src/grpc/`: gRPC Server for Runner communication

### CLI (apps/cli/)
- **Purpose**: Command-line client for sandbox management
- **Key patterns**: Commander.js for CLI structure, ssh2 for SSH connections, config stored in `~/.codepod/config.json`

## Important Conventions

### File Naming
| Type | Convention | Example |
|------|------------|---------|
| Go source | `snake_case.go` | `sandbox_handler.go` |
| TypeScript source | `kebab-case.ts` | `sandbox-handler.ts` |
| Python source | `snake_case.py` | `sandbox_handler.py` |
| Protobuf | `snake_case.proto` | `runner.proto` |

### Module Structure
- `cmd/`: Entry points
- `pkg/`: Public packages (reusable)
- `internal/`: Internal packages (not exported)
- `internal/{component}/`: Component core logic

## Design Documents

Reference these for implementation details:
- `docs/plans/2026-02-17-codepod-architecture.md`: System architecture
- `docs/plans/2026-02-17-codepod-code-structure.md`: Build system and directory structure
- `docs/plans/2026-02-17-agent-design.md`: Agent subsystem
- `docs/plans/2026-02-17-runner-design.md`: Runner subsystem
- `docs/plans/2026-02-17-server-design.md`: Server subsystem
- `docs/plans/2026-02-17-cli-design.md`: CLI subsystem

## Current State

The project is in active implementation. Core components (Agent, Runner, Server, CLI) are built. SDKs are partially implemented. Refer to the Makefile for build targets and current status via `make status`.

## Build Scripts

Custom build and development scripts are located in `scripts/` directory.
