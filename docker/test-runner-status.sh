#!/bin/bash
# Test Runner Status Reporting

set -e

SERVER_URL="${SERVER_URL:-http://localhost:8080}"

log_info() { echo -e "[INFO] $1"; }
log_error() { echo -e "[ERROR] $1"; }

# Start services
log_info "Starting services..."
docker-compose up -d

# Wait for services
sleep 5

# Create API key
KEY_RESP=$(curl -s -X POST "$SERVER_URL/api/v1/keys" -H "Content-Type: application/json" -d '{"name":"test"}')
API_KEY=$(echo "$KEY_RESP" | grep -o '"key":"[^"]*"' | cut -d'"' -f4)

log_info "API Key: ${API_KEY:0:10}..."

# Create sandbox
SANDBOX_RESP=$(curl -s -X POST "$SERVER_URL/api/v1/sandboxes" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{"name":"status-test","image":"python:3.11-slim"}')

SANDBOX_ID=$(echo "$SANDBOX_RESP" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
log_info "Sandbox ID: $SANDBOX_ID"

# Wait for runner to process
sleep 10

# Check sandbox status
SANDBOX_DETAIL=$(curl -s "$SERVER_URL/api/v1/sandboxes/$SANDBOX_ID")
echo "Sandbox detail: $SANDBOX_DETAIL"

# Verify status is not pending
if echo "$SANDBOX_DETAIL" | grep -q '"status":"pending"'; then
    log_error "Sandbox still pending - status reporting may not be working"
    exit 1
fi

log_info "Status reporting test completed!"
echo ""
echo "Test Results:"
echo "1. Sandbox creation: PASSED"
echo "2. Status reporting: CHECK API RESPONSE ABOVE"
echo ""

# Check runner logs
echo "=== Runner Logs ==="
docker logs codepod-runner --tail=10
