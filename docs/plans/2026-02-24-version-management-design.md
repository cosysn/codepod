# Version Management and Release Design

## Overview

Implement Git Tag-driven versioning for CodePod to support version distribution. All components share a unified version derived from Git tags, accessible via `--version` flag. Includes release command for generating distribution packages.

## Version Scheme

- **Format**: SemVer `v1.2.3` (e.g., `v1.0.0`, `v1.2.3-beta`)
- **Source**: Git tag (e.g., `git tag v1.2.3`)
- **Fallback**: `v0.0.0-dev` when no tag exists

## Architecture

### Components Affected

| Component | Language | Version Source | Injection Method |
|-----------|----------|----------------|------------------|
| Agent     | Go       | Git Tag        | ldflags `-X main.Version` + `--version` flag |
| Runner    | Go       | Git Tag        | ldflags `-X main.Version` + `--version` flag |
| Server    | TypeScript | fixed `0.0.0` | Runtime injection via env var |
| CLI       | TypeScript | fixed `0.0.0` | Runtime injection via env var |

### Version Strategy

- **Go Components**: Version injected via ldflags at build time, accessible via `--version` flag
- **TypeScript Components**: Version fixed at `0.0.0` in package.json, runtime reads from environment variable `CODPOD_VERSION`

### Data Flow

```
Git Tag (v1.2.3)
    │
    ▼
Makefile reads tag via git describe
    │
    ├─► Go ldflags: -X main.Version=v1.2.3
    ├─► TypeScript: CODPOD_VERSION=v1.2.3 env var
    │
    ▼
Binary/JS bundle includes version
    │
    ▼
./codepod --version → v1.2.3
./codepod-agent --version → v1.2.3
```

## Implementation Details

### 1. Go Components (Agent, Runner)

Add version variable and flag in `cmd/main.go`:

```go
var Version = "v0.0.0-dev"

func main() {
    flag.BoolVar(&showVersion, "version", false, "Show version")
    flag.BoolVar(&showVersion, "v", false, "Show version (shorthand)")
    flag.Parse()
    if showVersion {
        fmt.Println(Version)
        os.Exit(0)
    }
    // ... existing code
}
```

Build with ldflags in Makefile:

```makefile
VERSION := $(shell git describe --tags --always --dirty 2>/dev/null || echo "v0.0.0-dev")

build-agent-amd64:
	cd $(AGENT_DIR) && GOOS=linux GOARCH=amd64 CGO_ENABLED=0 \
		go build -ldflags "-X main.Version=$(VERSION)" -o ../../$(BUILD_DIR)/agent ./cmd
```

### 2. TypeScript Components (Server, CLI)

Update version.ts to read from environment variable:

```typescript
// src/version.ts
export const VERSION = process.env.CODPOD_VERSION || '0.0.0';
```

Add version flag to CLI (already has Commander.js support, verify it works):

```typescript
// src/index.ts - already has .version(VERSION), verify works
```

### 3. Makefile Updates

Add VERSION variable and release targets:

```makefile
VERSION := $(shell git describe --tags --always --dirty 2>/dev/null || echo "v0.0.0-dev")
RELEASE_DIR := releases/$(VERSION)

version:
	@echo $(VERSION)

ensure-release-dir:
	mkdir -p $(RELEASE_DIR)

release: ensure-release-dir build
	@echo "Creating release packages for $(VERSION)..."
	@# Package each component (Linux amd64)
	cd $(BUILD_DIR)/cli && tar -czf ../../../$(RELEASE_DIR)/codepod-cli-$(VERSION)-linux-amd64.tar.gz .
	cd $(BUILD_DIR)/server && tar -czf ../../../$(RELEASE_DIR)/codepod-server-$(VERSION)-linux-amd64.tar.gz .
	cd $(BUILD_DIR) && tar -czf $(RELEASE_DIR)/codepod-agent-$(VERSION)-linux-amd64.tar.gz agent
	cd $(RELEASE_DIR) && tar -czf codepod-runner-$(VERSION)-linux-amd64.tar.gz ../$(BUILD_DIR)/runner
	@# Copy install scripts
	cp scripts/install.sh $(RELEASE_DIR)/
	cp scripts/install.bat $(RELEASE_DIR)/
	@echo "Release created: $(RELEASE_DIR)/"
	@ls -la $(RELEASE_DIR)/
```

### 4. Install Scripts

Create `scripts/install.sh` (Linux):

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

Create `scripts/install.bat` (Windows):

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

## Release Workflow

```bash
# 1. Create and push tag
git tag v1.2.3
git push origin v1.2.3

# 2. Build all components
make build

# 3. Verify version
./build/cli/codepod --version  # v1.2.3
./build/agent --version        # v1.2.3
./build/runner --version       # v1.2.3
CODPOD_VERSION=v1.2.3 node ./build/cli/dist/index.js --version  # v1.2.3

# 4. Create release
make release

# 5. Output
# releases/v1.2.3/
# ├── codepod-cli-v1.2.3-linux-amd64.tar.gz
# ├── codepod-server-v1.2.3-linux-amd64.tar.gz
# ├── codepod-agent-v1.2.3-linux-amd64.tar.gz
# ├── codepod-runner-v1.2.3-linux-amd64.tar.gz
# ├── install.sh
# └── install.bat
```

## Error Handling

- **No git**: Fallback to `v0.0.0-dev`
- **Dirty git tree**: Append `-dirty` (e.g., `v1.2.3-dirty`)
- **No tags**: Fallback to `v0.0.0-dev`
- **Missing component**: Skip gracefully, continue with others

## Testing

1. Verify version displays correctly for all components
2. Test fallback when no git tags exist
3. Test with dirty git tree
4. Test release command generates correct tar.gz files
5. Test install.sh script
6. Test install.bat script

## Future Enhancements

- Multi-platform builds (darwin, windows, arm64)
- Docker image tagging and push
- GitHub Release automation with changelog
- Package manager support (apt, yum, brew)
- WSL-specific installation logic
