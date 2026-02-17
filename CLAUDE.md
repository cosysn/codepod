# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CodePod is a secure sandbox platform for isolated development environments and AI Agent execution. It provides Docker-based sandboxes with SSH access, multiple language runtimes (Python, Node.js, Go), and multi-language SDKs.

## Development Commands

```bash
# Install dependencies (run from project root)
go work sync          # Go workspace dependencies
go mod download      # Download Go modules
npm install          # Node.js dependencies (npm/pnpm)

# Build all components
make build

# Build individual components
cd apps/agent && go build -o ../../bin/agent ./cmd
cd apps/runner && go build -o ../../bin/runner ./cmd
cd apps/server && npm run build
cd apps/cli && npm run build

# Generate protobuf files
buf generate

# Run tests
make test
cd apps/agent && go test ./...
cd apps/runner && go test ./...
cd apps/server && npm test
cd apps/cli && npm test

# Docker development
cd docker && docker-compose up -d
```

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
| CLI/SDK → Server | REST API | API Key |
| Server → Runner | gRPC (mTLS) | Runner Token |
| User → Agent | SSH | Temporary Token |
| Agent → Runner | HTTP | Agent Token |

### Runner Connection Model

Critical: Runners may be behind NAT/firewalls. Server cannot connect to Runners directly. Instead:
- Server runs as gRPC Server (port 50051)
- Runners actively connect to Server (reverse tunnel)
- Server pushes jobs through this established connection

## Core Subsystems

### Agent (apps/agent/)
- **Purpose**: SSH Server running as PID 1 in each Sandbox container
- **Key modules**:
  - `pkg/ssh/`: SSH server, session management, PTY
  - `pkg/exec/`: Command executor (shell and direct modes)
  - `pkg/process/`: Process management, zombie reaping, signal forwarding
  - `pkg/tunnel/`: Local/remote/dynamic port forwarding
  - `pkg/reporter/`: Heartbeat and status reporting to Runner

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

This repository contains **design documents only**. The implementation (apps/, libs/, proto/ directories) has not yet been created. Start implementation according to the design documents in `docs/plans/`.
