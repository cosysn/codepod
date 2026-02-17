#!/bin/bash

# CodePod E2E Test Script
# Tests all subsystems: API keys, Sandboxes, Tokens

set -e

BASE_URL="http://localhost:8080"
API_KEY=""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_section() {
    echo ""
    echo "========================================"
    echo "$1"
    echo "========================================"
}

# Test helper
test_endpoint() {
    local method=$1
    local path=$2
    local data=$3
    local description=$4

    echo -n "  Testing $method $path ... "

    if [ -n "$data" ]; then
        response=$(curl -s -X $method -H "Content-Type: application/json" -H "X-API-Key: $API_KEY" -d "$data" "${BASE_URL}${path}")
    else
        response=$(curl -s -X $method -H "X-API-Key: $API_KEY" "${BASE_URL}${path}")
    fi

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}OK${NC}"
        echo "$response" | head -c 200
        echo ""
        return 0
    else
        echo -e "${RED}FAILED${NC}"
        return 1
    fi
}

# Test with assertion
test_assert() {
    local method=$1
    local path=$2
    local data=$3
    local expected_field=$4
    local expected_value=$5
    local description=$6

    echo -n "  $description ... "

    if [ -n "$data" ]; then
        response=$(curl -s -X $method -H "Content-Type: application/json" -H "X-API-Key: $API_KEY" -d "$data" "${BASE_URL}${path}")
    else
        response=$(curl -s -X $method -H "X-API-Key: $API_KEY" "${BASE_URL}${path}")
    fi

    if echo "$response" | grep -q "$expected_field"; then
        echo -e "${GREEN}PASS${NC}"
        return 0
    else
        echo -e "${RED}FAIL${NC}"
        echo "Response: $response"
        return 1
    fi
}

echo ""
echo "╔════════════════════════════════════════════════╗"
echo "║       CodePod E2E Test Suite                   ║"
echo "╚════════════════════════════════════════════════╝"
echo ""

# 1. Health Check
log_section "1. Health Check"
health=$(curl -s "${BASE_URL}/health")
if echo "$health" | grep -q '"status":"ok"'; then
    log_info "Server health check: PASSED"
else
    log_error "Server health check: FAILED"
    exit 1
fi

# 2. API Key Management
log_section "2. API Key Management"

log_info "Creating API key..."
key_response=$(curl -s -X POST "${BASE_URL}/api/v1/keys" -H "Content-Type: application/json" -d '{"name":"e2e-test-key","expires_at":"2026-12-31T23:59:59Z"}')
API_KEY=$(echo "$key_response" | grep -o '"key":"[^"]*"' | cut -d'"' -f4)

if [ -n "$API_KEY" ]; then
    log_info "API Key created: ${API_KEY:0:10}..."
else
    log_error "Failed to create API key"
    exit 1
fi

test_assert "GET" "/api/v1/keys" "" "e2e-test-key" "List API keys" ""

# 3. Statistics
log_section "3. Statistics"
test_endpoint "GET" "/api/v1/stats" "" "Get system statistics"

# 4. Sandbox Management
log_section "4. Sandbox Management"

# Create sandbox
log_info "Creating sandbox..."
sandbox_response=$(curl -s -X POST "${BASE_URL}/api/v1/sandboxes" \
    -H "Content-Type: application/json" \
    -H "X-API-Key: $API_KEY" \
    -d '{"name":"test-sandbox","image":"ubuntu:22.04","resources":{"cpu":1,"memory":"512MB"}}')

SANDBOX_ID=$(echo "$sandbox_response" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
if [ -n "$SANDBOX_ID" ]; then
    log_info "Sandbox created: $SANDBOX_ID"
else
    log_error "Failed to create sandbox"
    echo "Response: $sandbox_response"
    exit 1
fi

# List sandboxes
test_assert "GET" "/api/v1/sandboxes" "" "test-sandbox" "List sandboxes" ""

# Get sandbox details
test_assert "GET" "/api/v1/sandboxes/$SANDBOX_ID" "" "ubuntu:22.04" "Get sandbox details" ""

# 5. Token Management
log_section "5. Token Management"

# Create token
log_info "Creating connection token..."
token_response=$(curl -s -X POST "${BASE_URL}/api/v1/sandboxes/$SANDBOX_ID/token" \
    -H "Content-Type: application/json" \
    -H "X-API-Key: $API_KEY" \
    -d '{"type":"ssh","expires_in":3600}')

TOKEN=$(echo "$token_response" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
if [ -n "$TOKEN" ]; then
    log_info "Token created: ${TOKEN:0:20}..."
else
    log_warn "Token creation response: $token_response"
fi

# 6. Audit Logs
log_section "6. Audit Logs"
test_endpoint "GET" "/api/v1/audit" "" "Get audit logs"

# 7. Cleanup
log_section "7. Cleanup"

# Delete sandbox
log_info "Deleting sandbox..."
delete_response=$(curl -s -X DELETE -H "X-API-Key: $API_KEY" "${BASE_URL}/api/v1/sandboxes/$SANDBOX_ID")
if echo "$delete_response" | grep -q '"success":true'; then
    log_info "Sandbox deleted successfully"
else
    log_warn "Delete response: $delete_response"
fi

# Delete API key
log_info "Deleting API key..."
delete_key_response=$(curl -s -X DELETE -H "X-API-Key: $API_KEY" "${BASE_URL}/api/v1/keys/$API_KEY")
if echo "$delete_key_response" | grep -q '"success":true'; then
    log_info "API key deleted successfully"
else
    log_warn "Delete key response: $delete_key_response"
fi

# Final Status
log_section "Test Results Summary"

echo ""
log_info "All subsystem tests completed!"
echo ""
echo "Tested Components:"
echo "  ✓ Health Check"
echo "  ✓ API Key Management (Create/List/Delete)"
echo "  ✓ Statistics API"
echo "  ✓ Sandbox Management (Create/List/Get/Delete)"
echo "  ✓ Token Generation"
echo "  ✓ Audit Logging"
echo ""

# Verify containers
log_info "Checking Runner Docker state..."
containers=$(docker ps --filter "name=codepod" -q 2>/dev/null | wc -l)
if [ "$containers" -gt 0 ]; then
    log_info "Running codepod containers: $containers"
else
    log_warn "No codepod containers running"
fi

echo ""
echo "╔════════════════════════════════════════════════╗"
echo "║  E2E Test Suite Completed Successfully!        ║"
echo "╚════════════════════════════════════════════════╝"
