# Runner Dockerfile

# Stage 1: Build Runner
FROM golang:1.24-alpine AS runner-builder

# Build arguments
ARG GOPROXY=https://mirrors.aliyun.com/goproxy/,direct

WORKDIR /app

# Install git for go mod download
RUN apk add --no-cache git

COPY sandbox/runner/go.mod ./
RUN GOPROXY=$GOPROXY go mod download

COPY sandbox/runner/ .

# Build the binary (go mod tidy to fix missing sum entries)
RUN go mod tidy && CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o runner ./cmd

# Stage 2: Build Agent
FROM golang:1.24-alpine AS agent-builder

# Build arguments
ARG GOPROXY=https://mirrors.aliyun.com/goproxy/,direct
ARG GOSUMDB=off

WORKDIR /app

# Install git for go mod download
RUN apk add --no-cache git

COPY sandbox/agent/go.mod ./
RUN GOSUMDB=$GOSUMDB GOPROXY=$GOPROXY go mod download

COPY sandbox/agent/ .

# Build agent binary (go mod tidy to generate go.sum if needed)
RUN GOSUMDB=$GOSUMDB GOPROXY=$GOPROXY go mod tidy && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -a -installsuffix cgo -o agent ./cmd

# Stage 3: Production image
FROM alpine:3.19

RUN apk add --no-cache \
    docker-cli \
    ca-certificates \
    bind-tools \
    openssh-client \
    && rm -rf /var/cache/apk/*

# Configure Docker daemon to allow insecure registries
RUN mkdir -p /etc/docker && \
    cat > /etc/docker/daemon.json << 'EOF'
{
  "insecure-registries": ["172.18.0.5:5000"]
}
EOF

WORKDIR /app

# Copy runner from builder
COPY --from=runner-builder /app/runner ./

# Copy agent binary
COPY --from=agent-builder /app/agent /usr/local/bin/agent

# Create wait-for-server script
RUN echo '#!/bin/sh' > /app/wait-for-server.sh && \
    echo 'SERVER_URL="${CODEPOD_SERVER_URL:-http://server:8080}"' >> /app/wait-for-server.sh && \
    echo 'SERVER_HOST=$(echo "$SERVER_URL" | sed -E '"'"'s|https?://([^/:]+).*|\1|'"'"')' >> /app/wait-for-server.sh && \
    echo 'echo "Waiting for server DNS resolution: $SERVER_HOST"' >> /app/wait-for-server.sh && \
    echo 'for i in 1 2 3 4 5 6 7 8 9 10; do' >> /app/wait-for-server.sh && \
    echo '    if nslookup "$SERVER_HOST" > /dev/null 2>&1 || getent hosts "$SERVER_HOST" > /dev/null 2>&1; then' >> /app/wait-for-server.sh && \
    echo '        echo "Server DNS resolved: $SERVER_HOST"' >> /app/wait-for-server.sh && \
    echo '        break' >> /app/wait-for-server.sh && \
    echo '    fi' >> /app/wait-for-server.sh && \
    echo '    echo "Waiting for server... ($i/10)"' >> /app/wait-for-server.sh && \
    echo '    sleep 2' >> /app/wait-for-server.sh && \
    echo 'done' >> /app/wait-for-server.sh && \
    echo 'echo "Starting runner..."' >> /app/wait-for-server.sh && \
    echo 'exec /app/runner "$@"' >> /app/wait-for-server.sh && \
    chmod +x /app/wait-for-server.sh

# Allow runner to access Docker socket
RUN addgroup -S dockerroot 2>/dev/null || true
RUN adduser -S runner -G dockerroot 2>/dev/null || true

# Create config directory
RUN mkdir -p /app/config && chown -R runner:dockerroot /app

# Run as root for Docker socket access (can be changed to runner after fixing group mapping)
# USER runner

# Default configuration
ENV CODEPOD_SERVER_URL=http://server:8080
ENV CODEPOD_DOCKER_HOST=unix:///var/run/docker.sock
ENV CODEPOD_DOCKER_NETWORK=codepod-network
ENV CODEPOD_MAX_JOBS=10
ENV CODEPOD_LOG_LEVEL=info

ENTRYPOINT ["/app/wait-for-server.sh"]
