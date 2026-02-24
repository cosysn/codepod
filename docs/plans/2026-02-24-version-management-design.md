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
| Agent     | Go       | Git Tag        | ldflags `-X main.Version` |
| Runner    | Go       | Git Tag        | ldflags `-X main.Version` |
| Server    | TypeScript | package.json  | npm version + build replace |
| CLI       | TypeScript | package.json  | npm version + build replace |

### Version Strategy

- **Go Components**: Version injected via ldflags at build time (not stored in code)
- **TypeScript Components**: Version in package.json, updated via `npm version` or auto-sync during build

### Data Flow

```
Git Tag (v1.2.3)
    │
    ▼
Makefile reads tag via git describe
    │
    ├─► Go ldflags: -X main.Version=v1.2.3
    ├─► TypeScript: update package.json version, replace in build
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

Add version variable in `cmd/main.go`:

```go
var Version = "v0.0.0-dev"

func main() {
    // Add flag handling
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

Update package.json scripts to handle version:

```json
{
  "scripts": {
    "prebuild": "node scripts/sync-version.js",
    "build": "tsc && cp package.json dist/"
  }
}
```

Create `scripts/sync-version.js`:

```javascript
const fs = require('fs');
const { execSync } = require('child_process');

const version = execSync('git describe --tags --always --dirty 2>/dev/null || echo "v0.0.0-dev"', { encoding: 'utf8' }).trim();
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

if (pkg.version !== version) {
  pkg.version = version;
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  console.log(`Version updated to ${version}`);
}
```

CLI already has version support via Commander.js, no changes needed.

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
	@# Package each component
	cd $(BUILD_DIR)/cli && tar -czf ../../../$(RELEASE_DIR)/codepod-cli-$(VERSION)-linux-amd64.tar.gz .
	cd $(BUILD_DIR)/server && tar -czf ../../../$(RELEASE_DIR)/codepod-server-$(VERSION)-linux-amd64.tar.gz .
	cd $(BUILD_DIR) && tar -czf $(RELEASE_DIR)/codepod-agent-$(VERSION)-linux-amd64.tar.gz agent
	cd $(BUILD_DIR) && tar -czf $(RELEASE_DIR)/codepod-runner-$(VERSION)-linux-amd64.tar.gz runner
	@# Copy install script
	cp scripts/install.sh $(RELEASE_DIR)/
	@echo "Release created: $(RELEASE_DIR)/"
	@ls -la $(RELEASE_DIR)/
```

### 4. Install Script

Create `scripts/install.sh`:

```bash
#!/bin/bash
set -e

VERSION=${1:-latest}
INSTALL_DIR=${INSTALL_DIR:-$HOME/.codepod}

echo "Installing CodePod $VERSION to $INSTALL_DIR..."

# Download and extract
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Add to PATH
echo "export PATH=\"$INSTALL_DIR/bin:\$PATH\"" >> ~/.bashrc
echo "export PATH=\"$INSTALL_DIR/bin:\$PATH\"" >> ~/.zshrc

echo "Installation complete!"
echo "Add $INSTALL_DIR/bin to your PATH"
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

# 4. Create release
make release

# 5. Output
# releases/v1.2.3/
# ├── codepod-cli-v1.2.3-linux-amd64.tar.gz
# ├── codepod-server-v1.2.3-linux-amd64.tar.gz
# ├── codepod-agent-v1.2.3-linux-amd64.tar.gz
# ├── codepod-runner-v1.2.3-linux-amd64.tar.gz
# └── install.sh
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

## Future Enhancements

- Multi-platform builds (darwin, windows, arm64)
- Docker image tagging and push
- GitHub Release automation with changelog
- Package manager support (apt, yum, brew)
