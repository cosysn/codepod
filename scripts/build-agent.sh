#!/bin/bash
# scripts/build-agent.sh

set -e

OUTPUT_DIR="${1:-./bin}"
mkdir -p ${OUTPUT_DIR}

echo "Building agent for linux/amd64..."
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o ${OUTPUT_DIR}/agent ./apps/agent/cmd

echo "Building agent for linux/arm64..."
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -o ${OUTPUT_DIR}/agent-arm64 ./apps/agent/cmd

echo "Agent binaries built:"
ls -la ${OUTPUT_DIR}/agent*
