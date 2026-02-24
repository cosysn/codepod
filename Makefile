# CodePod Build System
# All build outputs go to build/ directory

.PHONY: all clean build build-sdk build-agent build-agent-amd64 build-agent-arm64 build-runner build-server build-cli test help docker-up docker-down docker-logs docker-status build-devpod devpod-publish-builder clean-devpod

# Directory structure
BUILD_DIR := build
SDK_DIR := libs/sdk-go
RUNNER_DIR := sandbox/runner
AGENT_DIR := sandbox/agent
SERVER_DIR := sandbox/server
CLI_DIR := sandbox/cli
DOCKER_DIR := docker

# Version from Git tag or environment variable
VERSION := $(or $(VERSION),$(shell git describe --tags --always --dirty 2>/dev/null || echo "v0.0.0-dev"))
RELEASE_DIR := $(CURDIR)/releases/$(VERSION)

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
	@echo "Building Runner (version $(VERSION))..."
	@if [ -f $(RUNNER_DIR)/cmd/main.go ]; then \
		mkdir -p $(BUILD_DIR); \
		go build -buildvcs=false -ldflags "-X main.Version=$(VERSION)" -o $(BUILD_DIR)/runner $(RUNNER_DIR)/cmd; \
		echo "Runner built: $(BUILD_DIR)/runner"; \
	else \
		echo "Runner entry point not found: $(RUNNER_DIR)/cmd/main.go"; \
		echo "Skipping Runner build."; \
	fi

# Build Agent (Go) - requires cmd/main.go
# Supports multiple architectures: amd64 (x86_64), arm64
build-agent: build-agent-amd64 build-agent-arm64
	@echo ""
	@echo "Agent binaries built:"
	@ls -la $(CURDIR)/$(BUILD_DIR)/agent* 2>/dev/null || echo "No agent binaries found"

build-agent-amd64:
	@echo "Building agent for linux/amd64 (version $(VERSION))..."
	@if [ -f $(AGENT_DIR)/cmd/main.go ]; then \
		mkdir -p $(BUILD_DIR); \
		cd $(AGENT_DIR) && GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -buildvcs=false -ldflags "-X main.Version=$(VERSION)" -o ../../$(BUILD_DIR)/agent ./cmd && echo "Agent built: $(CURDIR)/$(BUILD_DIR)/agent" || echo "Agent build failed"; \
	else \
		echo "Agent entry point not found: $(AGENT_DIR)/cmd/main.go"; \
		echo "Skipping Agent build."; \
	fi

build-agent-arm64:
	@echo "Building agent for linux/arm64 (version $(VERSION))..."
	@if [ -f $(AGENT_DIR)/cmd/main.go ]; then \
		mkdir -p $(BUILD_DIR); \
		cd $(AGENT_DIR) && GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -buildvcs=false -ldflags "-X main.Version=$(VERSION)" -o ../../$(BUILD_DIR)/agent-arm64 ./cmd && echo "Agent built: $(CURDIR)/$(BUILD_DIR)/agent-arm64" || echo "Agent build failed"; \
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
	# Create bin directory and symlink for executable
	mkdir -p $(BUILD_DIR)/cli/bin
	ln -sf ../index.js $(BUILD_DIR)/cli/bin/codepod
	chmod +x $(BUILD_DIR)/cli/index.js
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
	@echo "Runner development mode - use go run in sandbox/runner/cmd/runner"

dev-agent:
	@echo "Agent development mode - use go run in sandbox/agent/cmd/agent"

dev-server:
	@echo "Server development mode - use npm run dev in sandbox/server"

dev-cli:
	@echo "CLI development mode - use npm run dev in sandbox/cli"

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

# DevPod targets
build-devpod:
	@echo "Building DevPod..."
	cd apps/devpod && npm install && npm run build

devpod-publish-builder:
	@echo "Building and publishing builder image..."
	docker build -t codepod/builder:latest ./apps/devpod/builder
	docker tag codepod/builder:latest localhost:5000/codepod/builder:latest
	docker push localhost:5000/codepod/builder:latest

clean-devpod:
	@echo "Cleaning DevPod..."
	rm -rf apps/devpod/dist
	rm -rf apps/devpod/node_modules

# Version display
version:
	@echo $(VERSION)

# Release targets
ensure-release-dir:
	@mkdir -p $(RELEASE_DIR)

release: ensure-release-dir build
	@echo "Creating release packages for $(VERSION)..."
	@# Package CLI - create proper structure with bin/
	@if [ -d "$(BUILD_DIR)/cli" ]; then \
		mkdir -p $(RELEASE_DIR)/tmp-cli && \
		cp -r $(BUILD_DIR)/cli/* $(RELEASE_DIR)/tmp-cli/ && \
		mkdir -p $(RELEASE_DIR)/tmp-cli/bin && \
		ln -sf ../index.js $(RELEASE_DIR)/tmp-cli/bin/codepod && \
		chmod +x $(RELEASE_DIR)/tmp-cli/index.js && \
		cd $(RELEASE_DIR)/tmp-cli && tar -czf $(RELEASE_DIR)/codepod-cli-$(VERSION)-linux-amd64.tar.gz . && \
		rm -rf $(RELEASE_DIR)/tmp-cli; \
	fi
	@# Package Server - create proper structure with bin/
	@if [ -d "$(BUILD_DIR)/server" ]; then \
		mkdir -p $(RELEASE_DIR)/tmp-server && \
		cp -r $(BUILD_DIR)/server/* $(RELEASE_DIR)/tmp-server/ && \
		mkdir -p $(RELEASE_DIR)/tmp-server/bin && \
		ln -sf ../server.js $(RELEASE_DIR)/tmp-server/bin/codepod-server && \
		chmod +x $(RELEASE_DIR)/tmp-server/server.js && \
		cd $(RELEASE_DIR)/tmp-server && tar -czf $(RELEASE_DIR)/codepod-server-$(VERSION)-linux-amd64.tar.gz . && \
		rm -rf $(RELEASE_DIR)/tmp-server; \
	fi
	@# Package Agent
	@if [ -f "$(BUILD_DIR)/agent" ]; then \
		cd $(BUILD_DIR) && tar -czf $(RELEASE_DIR)/codepod-agent-$(VERSION)-linux-amd64.tar.gz agent; \
	fi
	@# Package Runner
	@if [ -f "$(BUILD_DIR)/runner" ]; then \
		cd $(BUILD_DIR) && tar -czf $(RELEASE_DIR)/codepod-runner-$(VERSION)-linux-amd64.tar.gz runner; \
	fi
	@# Copy install scripts
	@if [ -f "scripts/install.sh" ]; then \
		cp scripts/install.sh $(RELEASE_DIR)/; \
	fi
	@if [ -f "scripts/install.bat" ]; then \
		cp scripts/install.bat $(RELEASE_DIR)/; \
	fi
	@# Build and export Docker images (use short version for tags)
	@if [ -d "$(BUILD_DIR)/cli" ] || [ -d "$(BUILD_DIR)/server" ]; then \
		echo "Building and exporting Docker images..."; \
		mkdir -p $(RELEASE_DIR)/docker; \
		DOCKER_TAG=$(shell echo $(VERSION) | cut -d'-' -f1); \
		echo "Using Docker tag: $$DOCKER_TAG"; \
		cd $(SERVER_DIR) && docker build -t codepod/server:$$DOCKER_TAG .; \
		docker save -o $(RELEASE_DIR)/docker/codepod-server-$$DOCKER_TAG.tar codepod/server:$$DOCKER_TAG; \
		cd $(CURDIR) && docker build -t codepod/runner:$$DOCKER_TAG -f $(CURDIR)/Dockerfile.runner .; \
		docker save -o $(RELEASE_DIR)/docker/codepod-runner-$$DOCKER_TAG.tar codepod/runner:$$DOCKER_TAG; \
	fi
	@echo ""
	@echo "Release created: $(RELEASE_DIR)/"
	@ls -la $(RELEASE_DIR)/

# Docker image build targets
DOCKER_REGISTRY ?= codepod
DOCKER_TAG ?= $(VERSION)

build-docker-server:
	@echo "Building Docker image for Server..."
	cd $(SERVER_DIR) && docker build -t $(DOCKER_REGISTRY)/server:$(DOCKER_TAG) .
	@echo "Server image built: $(DOCKER_REGISTRY)/server:$(DOCKER_TAG)"

build-docker-runner:
	@echo "Building Docker image for Runner (using pre-built binaries)..."
	docker build -t $(DOCKER_REGISTRY)/runner:$(DOCKER_TAG) -f Dockerfile.runner .
	@echo "Runner image built: $(DOCKER_REGISTRY)/runner:$(DOCKER_TAG)"

build-docker: build-docker-server build-docker-runner
	@echo "Docker images built successfully"

# Export Docker images to release directory
export-docker: build-docker
	@echo "Exporting Docker images to release..."
	@mkdir -p $(RELEASE_DIR)/docker
	@docker save -o $(RELEASE_DIR)/docker/codepod-server-$(DOCKER_TAG).tar $(DOCKER_REGISTRY)/server:$(DOCKER_TAG)
	@docker save -o $(RELEASE_DIR)/docker/codepod-runner-$(DOCKER_TAG).tar $(DOCKER_REGISTRY)/runner:$(DOCKER_TAG)
	@echo "Docker images exported to $(RELEASE_DIR)/docker/"
	@ls -la $(RELEASE_DIR)/docker/

# Load Docker images from release (for testing)
load-docker:
	@echo "Loading Docker images from release..."
	@docker load -i $(RELEASE_DIR)/docker/codepod-server-$(DOCKER_TAG).tar
	@docker load -i $(RELEASE_DIR)/docker/codepod-runner-$(DOCKER_TAG).tar
	@echo "Docker images loaded"
