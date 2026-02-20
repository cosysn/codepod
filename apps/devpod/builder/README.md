# DevPod Builder Image

This image is used by DevPod to build container images from Dockerfiles.

## Features

- Git for cloning repositories
- Docker for building images
- No additional tools (minimal image)

## Usage

Used internally by DevPod CLI for building development environment images.

## Build

```bash
docker build -t codepod/builder:latest ./builder
```
