# Builder image for DevPod
# Used to build container images from Dockerfiles

FROM ubuntu:22.04

# Install dependencies (no SSH - uses agent's built-in SSH server)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/run/docker \
    && chmod 666 /var/run/docker

# Install Docker CLI from official source (avoid openssh-client conflict)
# Use the static bash script to get docker CLI without system dependencies
RUN curl -fsSL https://get.docker.com -o /tmp/get-docker.sh \
    && sh /tmp/get-docker.sh --dry-run \
    && rm /tmp/get-docker.sh \
    || true

# Alternative: Install docker.io but remove ssh keys after
RUN apt-get update && apt-get install -y --no-install-recommends \
    docker.io \
    && rm -rf /var/lib/apt/lists/*

# Remove ssh client keys that might conflict with agent
RUN rm -f /usr/bin/ssh* /usr/sbin/sshd 2>/dev/null || true

# Create directories needed by agent (SSH host keys)
RUN mkdir -p /etc/ssh && chmod 755 /etc/ssh

# Create workspace directory
WORKDIR /workspace

# Default command
CMD ["/bin/bash"]
