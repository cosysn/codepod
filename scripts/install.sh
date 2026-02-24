#!/bin/bash
set -e

VERSION=${1:-""}
INSTALL_DIR=${INSTALL_DIR:-$HOME/.codepod}
IMPORT_DOCKER=${IMPORT_DOCKER:-true}

echo "Installing CodePod $VERSION to $INSTALL_DIR..."

# Create install directory
mkdir -p "$INSTALL_DIR"

# Detect current version from package.json if not provided
if [ -z "$VERSION" ]; then
    if [ -f ./package.json ]; then
        VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "unknown")
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
        for img in codepod-server-*.tar codepod-runner-*.tar; do
            if [ -f "docker/$img" ]; then
                img_name=$(echo "$img" | sed 's/-v[0-9.]*.*\.tar//')
                docker tag "codepod/${img_name}:latest" "codepod/${img_name}:${VERSION}" 2>/dev/null || true
            fi
        done

        echo "  Docker images imported successfully"
        echo ""
        echo "Docker images available:"
        docker images | grep codepod || true
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
echo "Install location: $INSTALL_DIR"
echo ""
echo "Add to PATH: export PATH=\"$INSTALL_DIR/bin:\$PATH\""
echo "Or restart your terminal"
