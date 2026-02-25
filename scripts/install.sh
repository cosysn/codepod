#!/bin/bash
set -e

VERSION=${1:-""}
# Default install dir for binaries
INSTALL_PREFIX=${INSTALL_PREFIX:-/usr/local}
# Data and config dir
DATA_DIR=${DATA_DIR:-$HOME/.codepod}
IMPORT_DOCKER=${IMPORT_DOCKER:-true}

echo "Installing CodePod v$VERSION..."

# Determine if we need sudo
if [ "$INSTALL_PREFIX" = "/usr/local" ] && [ ! -w "/usr/local/bin" ]; then
    SUDO=sudo
else
    SUDO=
fi

# Install binaries
echo "Installing binaries to $INSTALL_PREFIX/bin..."
$SUDO mkdir -p "$INSTALL_PREFIX/bin"

# Install CLI
if [ -d "codepod-cli" ]; then
    $SUDO mkdir -p "$INSTALL_PREFIX/lib/codepod-cli"
    $SUDO cp -r codepod-cli/* "$INSTALL_PREFIX/lib/codepod-cli/"
    $SUDO ln -sf "$INSTALL_PREFIX/lib/codepod-cli/index.js" "$INSTALL_PREFIX/bin/codepod"
    $SUDO chmod +x "$INSTALL_PREFIX/lib/codepod-cli/index.js"
    echo "  Installed CLI to $INSTALL_PREFIX/lib/codepod-cli/"
fi

# Install Server
if [ -d "codepod-server" ]; then
    $SUDO mkdir -p "$INSTALL_PREFIX/lib/codepod-server"
    $SUDO cp -r codepod-server/* "$INSTALL_PREFIX/lib/codepod-server/"
    $SUDO ln -sf "$INSTALL_PREFIX/lib/codepod-server/server.js" "$INSTALL_PREFIX/bin/codepod-server"
    $SUDO chmod +x "$INSTALL_PREFIX/lib/codepod-server/server.js"
    echo "  Installed Server to $INSTALL_PREFIX/lib/codepod-server/"
fi

# Install Agent (single binary)
if [ -f "agent" ]; then
    $SUDO cp agent "$INSTALL_PREFIX/bin/codepod-agent"
    $SUDO chmod +x "$INSTALL_PREFIX/bin/codepod-agent"
    echo "  Installed Agent to $INSTALL_PREFIX/bin/codepod-agent"
fi

# Install Runner (single binary)
if [ -f "runner" ]; then
    $SUDO cp runner "$INSTALL_PREFIX/bin/codepod-runner"
    $SUDO chmod +x "$INSTALL_PREFIX/bin/codepod-runner"
    echo "  Installed Runner to $INSTALL_PREFIX/bin/codepod-runner"
fi

# Create data/config directory
echo "Creating config directory at $DATA_DIR..."
mkdir -p "$DATA_DIR"

# Create default config if not exists
if [ ! -f "$DATA_DIR/config.yaml" ]; then
    cat > "$DATA_DIR/config.yaml" << 'EOF'
server:
  url: http://localhost:8080

runner:
  max_jobs: 10
EOF
    echo "  Created default config at $DATA_DIR/config.yaml"
fi

# Add to PATH (detect shell)
SHELL_RC=""
if [ -n "$BASH_VERSION" ]; then
    SHELL_RC="$HOME/.bashrc"
elif [ -n "$ZSH_VERSION" ]; then
    SHELL_RC="$HOME/.zshrc"
fi

if [ -n "$SHELL_RC" ]; then
    if ! grep -q "$INSTALL_PREFIX/bin" "$SHELL_RC" 2>/dev/null; then
        echo "export PATH=\"$INSTALL_PREFIX/bin:\$PATH\"" >> "$SHELL_RC"
        echo "export CODEPOD_HOME=\"$DATA_DIR\"" >> "$SHELL_RC"
        echo "Added $INSTALL_PREFIX/bin to PATH in $SHELL_RC"
    fi
fi

# Import Docker images if available
if [ "$IMPORT_DOCKER" = "true" ] && [ -d "docker" ]; then
    echo ""
    echo "Importing Docker images..."

    # Check if docker is available
    if command -v docker &> /dev/null; then
        for img in docker/codepod-*.tar; do
            if [ -f "$img" ]; then
                echo "  Loading: $img"
                docker load -i "$img"
            fi
        done

        # Tag images with version
        for img in docker/codepod-server-*.tar docker/codepod-runner-*.tar; do
            if [ -f "$img" ]; then
                img_name=$(echo "$img" | sed 's/.*codepod-\([^-]*\)-.*/\1/' | sed 's/-v.*//')
                docker tag "codepod/${img_name}:latest" "codepod/${img_name}:${VERSION}" 2>/dev/null || true
            fi
        done

        echo "  Docker images imported successfully"
        echo ""
        echo "Docker images available:"
        docker images | grep codepod | grep -v "^<none>" || true
    else
        echo "  Docker not found, skipping image import"
        echo "  To import manually, run:"
        echo "    docker load -i docker/codepod-server-*.tar"
        echo "    docker load -i docker/codepod-runner-*.tar"
    fi
fi

echo ""
echo "Installation complete!"
echo "Version: v$VERSION"
echo ""
echo "Binaries: $INSTALL_PREFIX/bin/"
echo "Config:   $DATA_DIR/config.yaml"
echo ""
echo "Please restart your terminal or run:"
echo "  source ~/.bashrc"
