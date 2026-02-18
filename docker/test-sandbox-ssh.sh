#!/bin/bash

# Sandbox SSH E2E Test Script
# Creates a sandbox, connects via SSH, runs a command

set -e

IMAGE="${CODEPOD_IMAGE:-codepod/agent:latest}"
TOKEN="${AGENT_TOKEN:-test-token-12345}"
SANDBOX_ID="e2e-test-$(date +%s)"

echo "=== Sandbox SSH E2E Test ==="
echo "Image: $IMAGE"
echo "Sandbox ID: $SANDBOX_ID"

# Cleanup function
cleanup() {
    echo "[Cleanup] Stopping and removing container..."
    docker stop ${SANDBOX_ID} >/dev/null 2>&1 || true
    docker rm -f ${SANDBOX_ID} >/dev/null 2>&1 || true
}

trap cleanup EXIT

# Run sandbox container
echo "[1/4] Starting sandbox container..."
CONTAINER_ID=$(docker run -d \
    --name ${SANDBOX_ID} \
    --network host \
    -e AGENT_TOKEN=${TOKEN} \
    -e AGENT_SANDBOX_ID=${SANDBOX_ID} \
    ${IMAGE})

echo "Container started: ${CONTAINER_ID}"

# Wait for SSH to be ready
echo "[2/4] Waiting for SSH to be ready..."
for i in {1..30}; do
    if docker exec ${SANDBOX_ID} sh -c "which sshd" >/dev/null 2>&1; then
        echo "SSH daemon found"
        break
    fi
    sleep 1
done

# Additional wait for SSH to be fully ready
sleep 2

# Check container status
echo "[3/4] Checking container status..."
STATUS=$(docker inspect -f '{{.State.Status}}' ${CONTAINER_ID})
echo "Container status: ${STATUS}"

if [ "$STATUS" != "running" ]; then
    echo "ERROR: Container is not running!"
    docker logs ${CONTAINER_ID} 2>&1 | tail -30
    exit 1
fi

# Try SSH connection
echo "[4/4] Testing SSH connection..."
# Use sshpass if available, otherwise expect timeout
if command -v sshpass >/dev/null 2>&1; then
    SSH_OUTPUT=$(sshpass -p ${TOKEN} ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 root@127.0.0.1 "echo 'SSH connection successful'" 2>&1 || echo "SSH_FAILED")
else
    echo "WARNING: sshpass not found, skipping SSH test"
    echo "Install sshpass: apt-get install sshpass"
    echo "=== TEST PASSED (container started) ==="
    exit 0
fi

if echo "$SSH_OUTPUT" | grep -q "SSH connection successful"; then
    echo "=== TEST PASSED ==="
    echo "Successfully connected via SSH and executed command"
    exit 0
else
    echo "=== TEST FAILED ==="
    echo "SSH output: $SSH_OUTPUT"
    echo ""
    echo "Container logs:"
    docker logs ${CONTAINER_ID} 2>&1 | tail -30
    exit 1
fi
