# Builder image for DevPod
# Used to build container images from Dockerfiles

FROM ubuntu:22.04

# Install dependencies (no SSH - uses agent's built-in SSH server)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    curl \
    docker.io \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/run/docker \
    && chmod 666 /var/run/docker

# Create directories needed by agent (SSH host keys)
RUN mkdir -p /etc/ssh && chmod 755 /etc/ssh

# Create workspace directory
WORKDIR /workspace

# Default command
CMD ["/bin/bash"]
