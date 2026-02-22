# envbuilder Registry Mirror Fix Design

> **For Claude:** Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Fix registry mirror configuration and add base image cache support to enable building images in China network environment.

**Architecture:**
- Add `--base-image-cache-dir` flag to allow pre-loading base images
- Fix Kaniko registry mirror configuration to work properly with Chinese mirrors
- Add support for multiple registry mirrors (docker.io, gcr.io, ghcr.io, etc.)
- Follow Coder's envbuilder implementation pattern

**Tech Stack:** Go 1.25, Kaniko v1.23.2, Docker-less container builds

---

## Background

The current implementation has two issues:
1. Registry mirrors configured via `--registry-mirror` flag are not being applied correctly to Kaniko
2. No way to use pre-cached base images when network is limited

## Solution

### 1. Base Image Cache Directory

Allow users to mount a directory containing pre-pulled base images. This follows Coder's approach:
- `--base-image-cache-dir` flag (or env var `ENVBUILDER_BASE_IMAGE_CACHE_DIR`)
- Read-only mount containing cached images
- Kaniko checks this directory before pulling from remote registry

### 2. Registry Mirror Fix

Configure Kaniko registry mirrors properly:
- Support multiple mirrors (comma-separated)
- Apply to common registries: docker.io, gcr.io, ghcr.io, etc.
- Use environment variable approach that Kaniko understands

### 3. Multiple Mirror Support

Support both:
- Registry-specific mirrors (e.g., use Aliyun for docker.io)
- General fallback mirrors

---

## Files to Modify

1. **cmd/main.go**
   - Add `--base-image-cache-dir` flag

2. **pkg/builder/kaniko_lib.go**
   - Add BaseImageCacheDir field
   - Fix registry mirror configuration
   - Add multi-registry mirror support
