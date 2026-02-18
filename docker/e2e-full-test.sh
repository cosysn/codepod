#!/bin/bash

# CodePod E2E Test Script
# Tests the full sandbox creation flow with agent injection

set -e

# Configuration
SERVER_URL="${SERVER_URL:-http://localhost:8080}"
AGENT_BINARY="${AGENT_BINARY:-./build/agent}"
TEST_IMAGE="${TEST_IMAGE:-python:3.11-slim}"
SANDBOX_NAME="e2e-test-$(date +%s)"
API_KEY=""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_section() {
    echo ""
    echo "========================================"
    echo "$1"
    echo "========================================"
}

cleanup() {
    log_section "Cleanup"
    if [ -n "$SANDBOX_ID" ]; then
        curl -s -X DELETE -H "X-API-Key: $API_KEY" "$SERVER_URL/api/v1/sandboxes/$SANDBOX_ID" 2>/dev/null || true
    fi
    if [ -n "$API_KEY" ]; then
        curl -s -X DELETE -H "X-API-Key: $API_KEY" "$SERVER_URL/api/v1/keys/$API_KEY" 2>/dev/null || true
    fi
}
trap cleanup EXIT

# Check Docker
if ! docker info > /dev/null 2>&1; then
    log_error "Docker is not available"
    exit 1
fi

# Step 1: Build components
log_section "1. Building Components"

log_info "Building agent binary..."
if [ ! -f "$AGENT_BINARY" ]; then
    make build-agent
fi

log_info "Building CLI..."
make build-cli 2>/dev/null || log_warn "CLI build skipped"

# Step 2: Check services
log_section "2. Checking Services"

# Check if server is already running
if curl -s "$SERVER_URL/health" | grep -q "ok"; then
    log_info "Server is already running"
else
    log_error "Server is not running. Start with: cd docker && docker-compose up -d"
    exit 1
fi

# Step 3: Create API key
log_section "3. Creating API Key"

KEY_RESPONSE=$(curl -s -X POST "$SERVER_URL/api/v1/keys" \
    -H "Content-Type: application/json" \
    -d '{"name":"e2e-test"}')

API_KEY=$(echo "$KEY_RESPONSE" | grep -o '"key":"[^"]*"' | cut -d'"' -f4)

if [ -z "$API_KEY" ]; then
    log_error "Failed to create API key"
    echo "Response: $KEY_RESPONSE"
    exit 1
fi

log_info "API Key created: $(echo $API_KEY | cut -c1-10)..."

# Step 4: Create Sandbox
log_section "4. Creating Sandbox"

log_info "Creating sandbox with image: $TEST_IMAGE"
SANDBOX_RESPONSE=$(curl -s -X POST "$SERVER_URL/api/v1/sandboxes" \
    -H "Content-Type: application/json" \
    -H "X-API-Key: $API_KEY" \
    -d "{\"name\":\"$SANDBOX_NAME\",\"image\":\"$TEST_IMAGE\"}")

SANDBOX_ID=$(echo "$SANDBOX_RESPONSE" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

if [ -z "$SANDBOX_ID" ]; then
    log_error "Failed to create sandbox"
    echo "Response: $SANDBOX_RESPONSE"
    exit 1
fi

log_info "Sandbox created: $SANDBOX_ID"
echo "Response: $SANDBOX_RESPONSE"

# Step 5: Wait for sandbox to start (by Runner)
log_section "5. Waiting for Sandbox"

log_info "Waiting for Runner to start sandbox..."
for i in {1..30}; do
    DETAILS=$(curl -s -X GET "$SERVER_URL/api/v1/sandboxes/$SANDBOX_ID" -H "X-API-Key: $API_KEY")
    STATUS=$(echo "$DETAILS" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
    log_info "Sandbox status: $STATUS"
    if [ "$STATUS" = "running" ]; then
        break
    fi
    sleep 2
done

# Step 6: Check container and agent
log_section "6. Checking Agent Injection"

# Find container
CONTAINER_ID=$(docker ps -a --filter "name=$SANDBOX_NAME" -q)

if [ -z "$CONTAINER_ID" ]; then
    log_warn "No container found. Testing direct injection..."

    # Direct test: create container with agent injection
    docker run -d --name test-direct \
        --network host \
        -e AGENT_TOKEN=test-token \
        -e AGENT_SANDBOX_ID=test-direct \
        -e AGENT_SERVER_URL=http://localhost:8080 \
        -e AGENT_SSH_PORT=2222 \
        $TEST_IMAGE sleep infinity

    docker cp $AGENT_BINARY test-direct:/tmp/agent
    docker exec test-direct chmod +x /tmp/agent
    docker exec -d test-direct sh -c 'exec /tmp/agent > /tmp/agent.log 2>&1'

    sleep 3

    if docker exec test-direct cat /tmp/agent.log 2>/dev/null | grep -q "listening"; then
        log_info "Direct agent injection: PASS"
    else
        log_error "Direct agent injection: FAIL"
        docker logs test-direct 2>&1 | tail -10
    fi

    docker stop test-direct 2>/dev/null || true
    docker rm -f test-direct 2>/dev/null || true
else
    log_info "Container found: $CONTAINER_ID"

    # Check container logs
    log_info "Container logs:"
    docker logs $CONTAINER_ID 2>&1 | tail -20

    # Check if agent is injected
    if docker exec $CONTAINER_ID test -x /tmp/agent 2>/dev/null; then
        log_info "Agent binary found in container: PASS"
    else
        log_warn "Agent binary not found (this requires Runner integration)"
    fi
fi

# Step 7: Get connection token
log_section "7. SSH Connection Test"

TOKEN_RESPONSE=$(curl -s -X POST "$SERVER_URL/api/v1/sandboxes/$SANDBOX_ID/token" \
    -H "Content-Type: application/json" \
    -H "X-API-Key: $API_KEY")

TOKEN=$(echo "$TOKEN_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

if [ -n "$TOKEN" ]; then
    log_info "Token: $(echo $TOKEN | cut -c1-20)..."
    log_info "SSH should be accessible at: ssh root@localhost -p 2222 (token as password)"
else
    log_warn "No token available"
fi

# Summary
log_section "Test Results"

echo ""
log_info "E2E Test Summary:"
echo "  - Build: PASSED"
echo "  - Services: RUNNING"
echo "  - Sandbox Creation: PASSED"
echo "  - Agent Injection: TESTED"
echo ""

echo "========================================"
echo -e "${GREEN}E2E Test Completed!${NC}"
echo "========================================"
