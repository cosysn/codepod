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

echo ""
echo "Installation complete!"
echo "Version: v$VERSION"
echo "Install location: $INSTALL_DIR"
echo ""
echo "Add to PATH: export PATH=\"$INSTALL_DIR/bin:\$PATH\""
echo "Or restart your terminal"
