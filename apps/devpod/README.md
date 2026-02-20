# DevPod

Development environment manager using CodePod Sandbox.

## Quick Start

```bash
# Configure CodePod endpoint
devpod config set endpoint http://localhost:8080

# Create workspace from Git repository
devpod up https://github.com/username/project
```

## Commands

| Command | Description |
|---------|-------------|
| `devpod up <repo-url>` | Create workspace and open VS Code |
| `devpod list` | List all workspaces |
| `devpod stop <name>` | Stop a workspace |
| `devpod start <name>` | Start a workspace |
| `devpod delete <name>` | Delete a workspace |

## Configuration

- `~/.devpod/config.json` - Global configuration
- `~/.devpod/workspaces/` - Workspace metadata

## Requirements

- CodePod Server running
- Docker Registry at localhost:5000
- Node.js 18+
