#!/bin/bash
# CodePod Build and Restart Script
# Builds all components and restarts Docker services

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "=========================================="
echo "CodePod Build and Restart Script"
echo "=========================================="
echo ""

# Change to project root
cd "$PROJECT_ROOT"

# Step 1: Sync Go workspace
echo "[1/6] Syncing Go workspace..."
go work sync

# Step 2: Build Server
echo "[2/6] Building Server..."
cd apps/server
npm install
npm run build
cd "$PROJECT_ROOT"

# Step 3: Build CLI
echo "[3/6] Building CLI..."
cd apps/cli
npm install
npm run build
cd "$PROJECT_ROOT"

# Step 4: Build Agent
echo "[4/6] Building Agent..."
cd apps/agent
go build -o ../../bin/agent ./cmd
cd "$PROJECT_ROOT"

# Step 5: Build Runner
echo "[5/6] Building Runner..."
cd apps/runner
go build -o ../../bin/runner ./cmd
cd "$PROJECT_ROOT"

# Step 6: Build and restart Docker services
echo "[6/6] Building and restarting Docker services..."
cd docker

# Stop existing containers
echo "Stopping existing containers..."
docker-compose down 2>/dev/null || true

# Build images
echo "Building Docker images..."
docker-compose build --no-cache

# Start services
echo "Starting services..."
docker-compose up -d

# Wait for services to be ready
echo "Waiting for services to be ready..."
sleep 10

# Check status
echo ""
echo "=========================================="
echo "Services Status:"
echo "=========================================="
docker-compose ps

echo ""
echo "Health Check:"
curl -s http://localhost:8080/health || echo "Server not ready yet"

echo ""
echo "=========================================="
echo "Build Complete!"
echo "=========================================="
echo ""
echo "Server: http://localhost:8080"
echo "CLI: apps/cli/dist/index.js"
echo ""
echo "To test SSH connection:"
echo "  cd apps/cli"
echo "  ./dist/index.js create python:3.11"
echo "  ./dist/index.js list"
echo ""
