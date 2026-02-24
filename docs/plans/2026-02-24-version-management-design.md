# Version Management Design

## Overview

Implement Git Tag-driven versioning for CodePod to support version distribution. All components will share a unified version derived from Git tags, accessible via `--version` flag.

## Version Scheme

- **Format**: SemVer `v1.2.3` (e.g., `v1.0.0`, `v1.2.3-beta`)
- **Source**: Git tag (e.g., `git tag v1.2.3`)
- **Fallback**: `v0.0.0-dev` when no tag exists

## Architecture

### Components Affected

| Component | Language | Version Injection Method |
|-----------|----------|--------------------------|
| Agent     | Go       | ldflags `-X`            |
| Runner    | Go       | ldflags `-X`            |
| Server    | TypeScript | build replace          |
| CLI       | TypeScript | build replace         |

### Data Flow

```
Git Tag (v1.2.3)
    │
    ▼
Makefile reads tag via git describe
    │
    ├─► Go ldflags: -X main.Version=v1.2.3
    ├─► TypeScript: replace __VERSION__ in build
    │
    ▼
Binary/JS bundle includes version
    │
    ▼
./codepod-agent --version → v1.2.3
```

## Implementation Details

### 1. Go Components (Agent, Runner)

Add version variable in `cmd/main.go`:

```go
var Version = "v0.0.0-dev"

func main() {
    // ... existing code
}
```

Build with ldflags:

```makefile
VERSION := $(shell git describe --tags 2>/dev/null || echo "v0.0.0-dev")

build-agent-amd64:
	cd $(AGENT_DIR) && GOOS=linux GOARCH=amd64 CGO_ENABLED=0 \
		go build -ldflags "-X main.Version=$(VERSION)" -o ../../$(BUILD_DIR)/agent ./cmd
```

### 2. TypeScript Components (Server, CLI)

Create `src/version.ts`:

```typescript
export const VERSION = '__VERSION__';
```

Update build script to replace:

```json
{
  "scripts": {
    "build": "tsc && node scripts/replace-version.js"
  }
}
```

Replace script:

```javascript
const version = require('child_process').execSync('git describe --tags 2>/dev/null || echo "v0.0.0-dev"').toString().trim();
const content = fs.readFileSync('dist/version.js', 'utf8').replace('__VERSION__', version);
fs.writeFileSync('dist/version.js', content);
```

### 3. Makefile Updates

Add version-related targets:

```makefile
VERSION := $(shell git describe --tags 2>/dev/null || echo "v0.0.0-dev")

version:
	@echo $(VERSION)

release-dry-run:
	@echo "Would create release for version $(VERSION)"
```

### 4. CLI Version Flag

Ensure each component supports `--version` / `-v`:

```go
// Go
import "flag"

var Version = "v0.0.0-dev"

func main() {
    flag.BoolVar(&showVersion, "version", false, "Show version")
    flag.Parse()
    if showVersion {
        fmt.Println(Version)
        os.Exit(0)
    }
}
```

```typescript
// TypeScript
import { VERSION } from './version';

commander
  .option('-v, --version', 'Show version', () => {
    console.log(VERSION);
    process.exit(0);
  });
```

## Release Workflow

```bash
# 1. Create tag
git tag v1.2.3

# 2. Build all components
make build

# 3. Verify version
./build/cli/codepod --version  # v1.2.3
./build/agent --version        # v1.2.3
./build/runner --version       # v1.2.3

# 4. Create release (future)
make release
```

## Error Handling

- **No git**: Fallback to `v0.0.0-dev`
- **Dirty git tree**: Append `-dirty` (e.g., `v1.2.3-dirty`)
- **No tags**: Fallback to `v0.0.0-dev`

## Testing

1. Verify version displays correctly for all components
2. Test fallback when no git tags exist
3. Test with dirty git tree
4. Test CI/CD pipeline with tag trigger

## Future Enhancements

- Release automation script (create GitHub Release, upload binaries)
- Changelog generation from commit messages
- Docker image tagging with version
