#!/bin/bash

# Test Agent injection into sandbox container

set -e

NETWORK="codepod-network"
IMAGE="codepod/agent:latest"

echo "=== Agent Injection E2E Test ==="

# Create network
echo "[1/6] Creating network..."
docker network create ${NETWORK} 2>/dev/null || true

# Run agent container
echo "[2/6] Starting agent container..."
CONTAINER_ID=$(docker run -d \
    --name test-agent \
    --network ${NETWORK} \
    -e AGENT_TOKEN=test-token \
    -e AGENT_SANDBOX_ID=test-sandbox \
    ${IMAGE})

echo "Container started: ${CONTAINER_ID}"

# Wait for startup
echo "[3/6] Waiting for container startup..."
sleep 3

# Check if container is running
echo "[4/6] Checking container status..."
STATUS=$(docker inspect -f '{{.State.Status}}' ${CONTAINER_ID} 2>/dev/null || echo "unknown")
echo "Container status: ${STATUS}"

if [ "$STATUS" != "running" ]; then
    echo "ERROR: Container is not running!"
    echo "Logs:"
    docker logs ${CONTAINER_ID} 2>&1 | tail -20
    docker stop ${CONTAINER_ID} >/dev/null 2>/dev/null || true
    docker rm ${CONTAINER_ID} >/dev/null 2>/dev/null || true
    docker network rm ${NETWORK} >/dev/null 2>/dev/null || true
    exit 1
fi

# Check logs
echo "[5/6] Checking container logs..."
LOGS=$(docker logs ${CONTAINER_ID} 2>&1 | tail -10)
echo "Logs:"
echo "$LOGS"

# Cleanup
echo "[6/6] Cleaning up..."
docker stop ${CONTAINER_ID} >/dev/null
docker rm ${CONTAINER_ID} >/dev/null
docker network rm ${NETWORK} >/dev/null 2>/dev/null || true

echo ""
echo "=== Test completed successfully! ==="
