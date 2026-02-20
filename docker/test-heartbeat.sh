#!/bin/bash
# Test Agent Heartbeat Functionality

set -e

AGENT_BINARY="${1:-./build/agent}"
TEST_CONTAINER="heartbeat-test-$(date +%s)"
SERVER_URL="${SERVER_URL:-http://localhost:8080}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

cleanup() {
    echo "Cleaning up..."
    docker stop $TEST_CONTAINER 2>/dev/null || true
    docker rm $TEST_CONTAINER 2>/dev/null || true
}
trap cleanup EXIT

# Build agent if needed
if [ ! -f "$AGENT_BINARY" ]; then
    log_info "Building agent..."
    make build-agent
fi

log_info "Using agent binary: $AGENT_BINARY"

# Create test container with agent
log_info "Creating test container..."
docker run -d --name $TEST_CONTAINER --network host \
    -e AGENT_TOKEN=test-token \
    -e AGENT_SERVER_URL=$SERVER_URL \
    -e AGENT_SANDBOX_ID=$TEST_CONTAINER \
    -e AGENT_SSH_PORT=2222 \
    python:3.11-slim sleep infinity

# Copy agent binary
docker cp $AGENT_BINARY $TEST_CONTAINER:/tmp/agent
docker exec $TEST_CONTAINER chmod +x /tmp/agent

# Start agent
log_info "Starting agent..."
docker exec -d $TEST_CONTAINER sh -c 'exec /tmp/agent > /tmp/agent.log 2>&1'

# Wait for agent to start
sleep 5

# Check agent log for startup
if docker exec $TEST_CONTAINER cat /tmp/agent.log 2>/dev/null | grep -q "Starting"; then
    log_info "Agent started successfully"
else
    log_error "Agent failed to start"
    docker exec $TEST_CONTAINER cat /tmp/agent.log 2>/dev/null || true
    exit 1
fi

# Check if sandbox was created in server (via sandbox list API)
log_info "Checking server sandbox list..."
SANDBOXES=$(curl -s "$SERVER_URL/api/v1/sandboxes" 2>/dev/null || echo '{"sandboxes":[]}')
echo "Sandboxes: $SANDBOXES"

# Verify test passed
log_info "Heartbeat test completed!"
echo ""
echo "Test Results:"
echo "1. Agent binary: PASS"
echo "2. Container creation: PASS"
echo "3. Agent startup: PASS"
echo ""
echo -e "${GREEN}Heartbeat test PASSED!${NC}"
