# Version Management Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement Git Tag-driven versioning and release package generation for CodePod.

**Architecture:** Version injected at build time via ldflags (Go) and environment variable (TypeScript). Release packages generated as tar.gz with install scripts.

**Tech Stack:** Go (ldflags), TypeScript (env var), Makefile, Shell scripts

---

## Task 1: Add Version to Agent (Go)

**Files:**
- Modify: `sandbox/agent/cmd/main.go`

**Step 1: Add version variable and flag to agent**

```go
// Add after imports
import (
    "flag"
)

// Add version variable
var Version = "v0.0.0-dev"
var showVersion bool

// Modify main function - add at the beginning
func main() {
    flag.BoolVar(&showVersion, "version", false, "Show version")
    flag.BoolVar(&showVersion, "v", false, "Show version (shorthand)")
    flag.Parse()

    if showVersion {
        fmt.Println(Version)
        os.Exit(0)
    }

    // ... rest of existing code
}
```

**Step 2: Verify the change compiles**

Run: `cd sandbox/agent && go build -o /tmp/agent-test ./cmd`
Expected: SUCCESS (no errors)

**Step 3: Test version flag**

Run: `/tmp/agent-test --version`
Expected: Output `v0.0.0-dev` or similar

**Step 4: Commit**

```bash
git add sandbox/agent/cmd/main.go
git commit -m "feat(agent): add version variable and --version flag"
```

---

## Task 2: Add Version to Runner (Go)

**Files:**
- Modify: `sandbox/runner/cmd/main.go`

**Step 1: Add version variable and flag to runner**

```go
// Add after imports
import (
    "flag"
)

// Add version variable
var Version = "v0.0.0-dev"
var showVersion bool

// Modify main function - add at the beginning
func main() {
    flag.BoolVar(&showVersion, "version", false, "Show version")
    flag.BoolVar(&showVersion, "v", false, "Show version (shorthand)")
    flag.Parse()

    if showVersion {
        fmt.Println(Version)
        os.Exit(0)
    }

    // ... rest of existing code
}
```

**Step 2: Verify the change compiles**

Run: `cd sandbox/runner && go build -o /tmp/runner-test ./cmd`
Expected: SUCCESS (no errors)

**Step 3: Test version flag**

Run: `/tmp/runner-test --version`
Expected: Output `v0.0.0-dev` or similar

**Step 4: Commit**

```bash
git add sandbox/runner/cmd/main.go
git commit -m "feat(runner): add version variable and --version flag"
```

---

## Task 3: Update TypeScript version.ts (CLI)

**Files:**
- Modify: `sandbox/cli/src/version.ts`

**Step 1: Update version.ts to read from environment variable**

```typescript
// Replace existing content
export const VERSION = process.env.CODPOD_VERSION || '0.0.0';
```

**Step 2: Verify CLI builds**

Run: `cd sandbox/cli && npm run build`
Expected: SUCCESS

**Step 3: Test version with env var**

Run: `CODPOD_VERSION=v1.2.3 node build/cli/dist/index.js --version`
Expected: Output `v1.2.3`

**Step 4: Test default version**

Run: `node build/cli/dist/index.js --version`
Expected: Output `0.0.0`

**Step 5: Commit**

```bash
git add sandbox/cli/src/version.ts
git commit -m "feat(cli): read version from CODPOD_VERSION env var"
```

---

## Task 4: Update TypeScript version.ts (Server)

**Files:**
- Modify: `sandbox/server/src/version.ts` (create if not exists)
- Check: `sandbox/server/src/index.ts`

**Step 1: Check if server has version.ts**

Run: `ls sandbox/server/src/version.ts`
Expected: File may not exist

**Step 2: Check how server handles version**

Run: `grep -r "version" sandbox/server/src/*.ts | head -10`
Expected: Find where version is used

**Step 3: Create or modify version.ts**

If file doesn't exist, create it:
```typescript
export const VERSION = process.env.CODPOD_VERSION || '0.0.0';
```

**Step 4: Verify server builds**

Run: `cd sandbox/server && npm run build`
Expected: SUCCESS

**Step 5: Commit**

```bash
git add sandbox/server/src/version.ts 2>/dev/null || true
git commit -m "feat(server): read version from CODPOD_VERSION env var"
```

---

## Task 5: Update Makefile with VERSION and release

**Files:**
- Modify: `Makefile`

**Step 1: Add VERSION variable at top of Makefile**

```makefile
# Add after BUILD_DIR definition
VERSION := $(shell git describe --tags --always --dirty 2>/dev/null || echo "v0.0.0-dev")
RELEASE_DIR := releases/$(VERSION)
```

**Step 2: Update build targets with ldflags**

Replace `build-agent-amd64` rule:
```makefile
build-agent-amd64:
	@echo "Building agent for linux/amd64..."
	@if [ -f $(AGENT_DIR)/cmd/main.go ]; then \
		mkdir -p $(BUILD_DIR); \
		cd $(AGENT_DIR) && GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "-X main.Version=$(VERSION)" -o ../../$(BUILD_DIR)/agent ./cmd && echo "Agent built: $(CURDIR)/$(BUILD_DIR)/agent" || echo "Agent build failed"; \
	else \
		echo "Agent entry point not found: $(AGENT_DIR)/cmd/main.go"; \
		echo "Skipping Agent build."; \
	fi
```

Replace `build-agent-arm64` rule similarly.

Replace `build-runner` rule:
```makefile
build-runner:
	@echo "Building Runner..."
	@if [ -f $(RUNNER_DIR)/cmd/main.go ]; then \
		mkdir -p $(BUILD_DIR); \
		cd $(RUNNER_DIR) && go build -ldflags "-X main.Version=$(VERSION)" -o ../$(BUILD_DIR)/runner ./cmd && echo "Runner built: $(BUILD_DIR)/runner"; \
	else \
		echo "Runner entry point not found: $(RUNNER_DIR)/cmd/main.go"; \
		echo "Skipping Runner build."; \
	fi
```

**Step 3: Add release targets**

Add at end of Makefile:
```makefile
# Version display
version:
	@echo $(VERSION)

# Release targets
ensure-release-dir:
	mkdir -p $(RELEASE_DIR)

release: ensure-release-dir build
	@echo "Creating release packages for $(VERSION)..."
	@# Package each component (Linux amd64)
	@if [ -d "$(BUILD_DIR)/cli" ]; then \
		cd $(BUILD_DIR)/cli && tar -czf ../../../$(RELEASE_DIR)/codepod-cli-$(VERSION)-linux-amd64.tar.gz .; \
	fi
	@if [ -d "$(BUILD_DIR)/server" ]; then \
		cd $(BUILD_DIR)/server && tar -czf ../../../$(RELEASE_DIR)/codepod-server-$(VERSION)-linux-amd64.tar.gz .; \
	fi
	@if [ -f "$(BUILD_DIR)/agent" ]; then \
		cd $(BUILD_DIR) && tar -czf $(RELEASE_DIR)/codepod-agent-$(VERSION)-linux-amd64.tar.gz agent; \
	fi
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
	@echo ""
	@echo "Release created: $(RELEASE_DIR)/"
	@ls -la $(RELEASE_DIR)/
```

**Step 4: Test version target**

Run: `make version`
Expected: Output version string (e.g., `v0.0.0-dev` or `v1.2.3`)

**Step 5: Commit**

```bash
git add Makefile
git commit -m "feat: add VERSION variable and release targets to Makefile"
```

---

## Task 6: Create install.sh script

**Files:**
- Create: `scripts/install.sh`

**Step 1: Create install.sh**

```bash
#!/bin/bash
set -e

VERSION=${1:-""}
INSTALL_DIR=${INSTALL_DIR:-$HOME/.codepod}

echo "Installing CodePod $VERSION to $INSTALL_DIR..."

# Create install directory
mkdir -p "$INSTALL_DIR"

# Detect current version from package.json if not provided
if [ -z "$VERSION" ]; then
    if [ -f ./package.json ]; then
        VERSION=$(node -p "require('./package.json').version")
    else
        VERSION="unknown"
    fi
fi

echo "Installing CodePod v$VERSION..."

# Extract components
for pkg in codepod-cli-*.tar.gz codepod-server-*.tar.gz codepod-agent-*.tar.gz codepod-runner-*.tar.gz; do
    if [ -f "$pkg" ]; then
        tar -xzf "$pkg" -C "$INSTALL_DIR"
        echo "  Extracted: $pkg"
    fi
done

# Create bin directory and symlinks
mkdir -p "$INSTALL_DIR/bin"

# Add CLI to PATH (detect shell)
SHELL_RC=""
if [ -n "$BASH_VERSION" ]; then
    SHELL_RC="$HOME/.bashrc"
elif [ -n "$ZSH_VERSION" ]; then
    SHELL_RC="$HOME/.zshrc"
fi

if [ -n "$SHELL_RC" ]; then
    if ! grep -q "$INSTALL_DIR/bin" "$SHELL_RC" 2>/dev/null; then
        echo "export PATH=\"$INSTALL_DIR/bin:\$PATH\"" >> "$SHELL_RC"
        echo "Added $INSTALL_DIR/bin to PATH in $SHELL_RC"
    fi
fi

# Create CLI symlink
if [ -f "$INSTALL_DIR/dist/index.js" ]; then
    ln -sf "$INSTALL_DIR/dist/index.js" "$INSTALL_DIR/bin/codepod"
    chmod +x "$INSTALL_DIR/dist/index.js"
fi

echo ""
echo "Installation complete!"
echo "Version: v$VERSION"
echo "Install location: $INSTALL_DIR"
echo ""
echo "Add to PATH: export PATH=\"$INSTALL_DIR/bin:\$PATH\""
echo "Or restart your terminal"
```

**Step 2: Make script executable**

Run: `chmod +x scripts/install.sh`

**Step 3: Test script exists**

Run: `ls -la scripts/install.sh`
Expected: File exists and is executable

**Step 4: Commit**

```bash
git add scripts/install.sh
git commit -m "feat: add install.sh script for Linux"
```

---

## Task 7: Create install.bat script

**Files:**
- Create: `scripts/install.bat`

**Step 1: Create install.bat**

```batch
@echo off
setlocal

set VERSION=%1
set INSTALL_DIR=%INSTALL_DIR%
if "%INSTALL_DIR%"=="" set INSTALL_DIR=%USERPROFILE%\.codepod

echo Installing CodePod %VERSION% to %INSTALL_DIR%...

mkdir "%INSTALL_DIR%" 2>nul

echo Extracting packages...
for %%f in (codepod-cli-*.zip codepod-server-*.zip codepod-agent-*.zip codepod-runner-*.zip) do (
    powershell -Command "Expand-Archive -Path '%%f' -DestinationPath '%INSTALL_DIR%' -Force"
)

echo Adding to PATH...
setx PATH "%INSTALL_DIR%\bin;%PATH%" >nul

echo.
echo Installation complete!
echo Version: %VERSION%
echo Install location: %INSTALL_DIR%
echo.
echo Please restart your terminal for PATH changes to take effect.
```

**Step 2: Commit**

```bash
git add scripts/install.bat
git commit -m "feat: add install.bat script for Windows"
```

---

## Task 8: End-to-end verification

**Files:**
- All modified files

**Step 1: Tag a version**

Run: `git tag v1.2.3`

**Step 2: Build all components**

Run: `make build`

**Step 3: Test version for Go components**

Run: `./build/agent --version`
Expected: Output `v1.2.3`

Run: `./build/runner --version`
Expected: Output `v1.2.3`

**Step 4: Test version for TypeScript components**

Run: `CODPOD_VERSION=v1.2.3 node build/cli/dist/index.js --version`
Expected: Output `v1.2.3`

**Step 5: Create release**

Run: `make release`

**Step 6: Verify release output**

Run: `ls -la releases/v1.2.3/`
Expected: Contains tar.gz files and install scripts

**Step 7: Commit**

```bash
git tag -d v1.2.3
git commit -m "test: verify version and release workflow"
```

---

## Summary

Implementation order:
1. Agent (Go) - version + flag
2. Runner (Go) - version + flag
3. CLI (TypeScript) - env var
4. Server (TypeScript) - env var
5. Makefile - VERSION + release
6. install.sh
7. install.bat
8. End-to-end verification
