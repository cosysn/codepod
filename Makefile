# CodePod Build System
# All build outputs go to build/ directory

.PHONY: all clean build build-sdk build-runner build-agent build-server build-cli test help docker-up docker-down docker-logs docker-status

# Directory structure
BUILD_DIR := build
SDK_DIR := libs/sdk-go
RUNNER_DIR := apps/runner
AGENT_DIR := apps/agent
SERVER_DIR := apps/server
CLI_DIR := apps/cli
DOCKER_DIR := docker

# Default target
all: help
	@echo "Use 'make help' to see available targets"

help:
	@echo "CodePod Build System"
	@echo ""
	@echo "Build Targets:"
	@echo "  build          - Build all components"
	@echo "  build-sdk      - Build SDK (Go)"
	@echo "  build-runner   - Build Runner (Go)"
	@echo "  build-agent    - Build Agent (Go)"
	@echo "  build-server   - Build Server (TypeScript)"
	@echo "  build-cli      - Build CLI (TypeScript)"
	@echo ""
	@echo "Test Targets:"
	@echo "  test           - Run all tests"
	@echo "  test-sdk       - Run SDK tests"
	@echo "  test-runner    - Run Runner tests"
	@echo "  test-agent     - Run Agent tests"
	@echo "  test-server    - Run Server tests"
	@echo "  test-cli       - Run CLI tests"
	@echo ""
	@echo "Utility Targets:"
	@echo "  clean          - Remove build artifacts"
	@echo "  help           - Show this help message"

# Create build directory (phony target)
ensure-build-dir:
	mkdir -p $(BUILD_DIR)

# Build SDK (Go)
build-sdk: ensure-build-dir
	@echo "Building SDK..."
	cd $(SDK_DIR) && go build -o ../$(BUILD_DIR)/sdk-go.a
	@echo "SDK built: $(BUILD_DIR)/sdk-go.a"

# Build Runner (Go) - requires cmd/main.go
build-runner:
	@echo "Building Runner..."
	@if [ -f $(RUNNER_DIR)/cmd/main.go ]; then \
		mkdir -p $(BUILD_DIR); \
		go build -o $(BUILD_DIR)/runner $(RUNNER_DIR)/cmd; \
		echo "Runner built: $(BUILD_DIR)/runner"; \
	else \
		echo "Runner entry point not found: $(RUNNER_DIR)/cmd/main.go"; \
		echo "Skipping Runner build."; \
	fi

# Build Agent (Go) - requires cmd/main.go
build-agent:
	@echo "Building Agent..."
	@if [ -f $(AGENT_DIR)/cmd/main.go ]; then \
		mkdir -p $(BUILD_DIR); \
		go build -o $(BUILD_DIR)/agent $(AGENT_DIR)/cmd; \
		echo "Agent built: $(BUILD_DIR)/agent"; \
	else \
		echo "Agent entry point not found: $(AGENT_DIR)/cmd/main.go"; \
		echo "Skipping Agent build."; \
	fi

# Build Server (TypeScript)
build-server:
	@echo "Building Server..."
	cd $(SERVER_DIR) && npm run build && cp package.json dist/
	mkdir -p $(BUILD_DIR)/server
	cp -r $(SERVER_DIR)/dist/* $(BUILD_DIR)/server/
	cp -r $(SERVER_DIR)/node_modules $(BUILD_DIR)/server/
	@echo "Server built: $(BUILD_DIR)/server"

# Build CLI (TypeScript)
build-cli:
	@echo "Building CLI..."
	cd $(CLI_DIR) && npm run build
	mkdir -p $(BUILD_DIR)/cli
	cp -r $(CLI_DIR)/dist/* $(BUILD_DIR)/cli/
	cp -r $(CLI_DIR)/node_modules $(BUILD_DIR)/cli/
	cp $(CLI_DIR)/package.json $(BUILD_DIR)/cli/
	@echo "CLI built: $(BUILD_DIR)/cli"

# Build all available components
build:
	@echo "Building all components..."
	@$(MAKE) ensure-build-dir
	@$(MAKE) build-sdk 2>/dev/null || true
	@$(MAKE) build-server 2>/dev/null || true
	@$(MAKE) build-cli 2>/dev/null || true
	@$(MAKE) build-runner 2>/dev/null || true
	@$(MAKE) build-agent 2>/dev/null || true
	@echo ""
	@echo "Build complete!"
	@ls -la $(BUILD_DIR)/ 2>/dev/null || echo "No build artifacts"

# Run all tests
test:
	@echo "Running all tests..."
	cd $(SDK_DIR) && go test ./...
	cd $(RUNNER_DIR) && go test ./...
	cd $(AGENT_DIR) && go test ./...
	cd $(SERVER_DIR) && npm test
	cd $(CLI_DIR) && npm test
	@echo ""
	@echo "All tests passed!"

# Test individual components
test-sdk:
	@echo "Running SDK tests..."
	cd $(SDK_DIR) && go test ./...

test-runner:
	@echo "Running Runner tests..."
	cd $(RUNNER_DIR) && go test ./...

test-agent:
	@echo "Running Agent tests..."
	cd $(AGENT_DIR) && go test ./...

test-server:
	@echo "Running Server tests..."
	cd $(SERVER_DIR) && npm test

test-cli:
	@echo "Running CLI tests..."
	cd $(CLI_DIR) && npm test

# Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	rm -rf $(BUILD_DIR)
	cd $(SDK_DIR) && rm -f ../$(BUILD_DIR)/sdk-go.a 2>/dev/null || true
	cd $(SERVER_DIR) && rm -rf dist
	cd $(CLI_DIR) && rm -rf dist
	@echo "Cleaned!"

# Show build status
status:
	@echo "Component Build Status:"
	@echo ""
	@echo "SDK:"
	@[ -f $(SDK_DIR)/go.mod ] && echo "  ✓ Go module exists" || echo "  ✗ Missing"
	@echo ""
	@echo "Runner:"
	@[ -f $(RUNNER_DIR)/cmd/main.go ] && echo "  ✓ Entry point exists" || echo "  ✗ Missing (cmd/main.go)"
	@echo ""
	@echo "Agent:"
	@[ -f $(AGENT_DIR)/cmd/main.go ] && echo "  ✓ Entry point exists" || echo "  ✗ Missing (cmd/main.go)"
	@echo ""
	@echo "Server:"
	@[ -f $(SERVER_DIR)/package.json ] && echo "  ✓ Package.json exists" || echo "  ✗ Missing"
	@[ -d $(SERVER_DIR)/src ] && echo "  ✓ Source directory exists" || echo "  ✗ Missing"
	@echo ""
	@echo "CLI:"
	@[ -f $(CLI_DIR)/package.json ] && echo "  ✓ Package.json exists" || echo "  ✗ Missing"
	@[ -d $(CLI_DIR)/src ] && echo "  ✓ Source directory exists" || echo "  ✗ Missing"

# Development targets
dev-sdk:
	@echo "SDK development mode - use go run in libs/sdk-go"

dev-runner:
	@echo "Runner development mode - use go run in apps/runner/cmd/runner"

dev-agent:
	@echo "Agent development mode - use go run in apps/agent/cmd/agent"

dev-server:
	@echo "Server development mode - use npm run dev in apps/server"

dev-cli:
	@echo "CLI development mode - use npm run dev in apps/cli"

# Docker Targets
docker-up:
	@echo "Starting CodePod services with Docker..."
	cd $(DOCKER_DIR) && docker-compose up -d --build
	@echo ""
	@echo "Services started! Check logs with: make docker-logs"
	@echo "Server: http://localhost:8080"

docker-down:
	@echo "Stopping CodePod services..."
	cd $(DOCKER_DIR) && docker-compose down
	@echo "Services stopped!"

docker-logs:
	@echo "Showing Docker logs (Ctrl+C to exit)..."
	cd $(DOCKER_DIR) && docker-compose logs -f

docker-status:
	@echo "Checking service status..."
	cd $(DOCKER_DIR) && docker-compose ps
	@echo ""
	@echo "Health check:"
	@curl -s http://localhost:8080/health || echo "Server not responding"

docker-restart:
	@echo "Restarting CodePod services..."
	cd $(DOCKER_DIR) && docker-compose down && docker-compose up -d
	@echo "Services restarted!"
