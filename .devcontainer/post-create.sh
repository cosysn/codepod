#!/bin/bash
set -e

echo "Setting up development environment..."

# 安装 Go 依赖
cd apps/agent && go mod download
cd ../runner && go mod download
cd ../../libs/sdk-go && go mod download

# 安装 Node.js 依赖
cd /workspace
npm install

# 安装 Node.js workspace 依赖
cd apps/server && npm install
cd ../cli && npm install
cd ../../libs/sdk-typescript && npm install

# 安装 Pre-commit hooks (optional)
# pip install pre-commit

echo "Development environment ready!"
