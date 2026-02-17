# Runner Dockerfile
FROM golang:1.21-alpine AS builder

WORKDIR /app

# Install git for go mod download
RUN apk add --no-cache git

COPY go.mod ./
RUN go mod download

# Copy go.sum only if it exists
RUN test -f go.sum && cp go.sum . || true

COPY . .

# Build the binary
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o runner ./cmd

# Production image
FROM alpine:3.19

RUN apk add --no-cache \
    docker-cli \
    ca-certificates \
    && rm -rf /var/cache/apk/*

WORKDIR /app

COPY --from=builder /app/runner ./

# Allow runner to access Docker socket
RUN addgroup -S dockerroot 2>/dev/null || true
RUN adduser -S runner -G dockerroot 2>/dev/null || true

# Create config directory
RUN mkdir -p /app/config && chown -R runner:dockerroot /app

USER runner

# Default configuration
ENV CODEPOD_SERVER_URL=http://server:50051
ENV CODEPOD_DOCKER_HOST=unix:///var/run/docker.sock
ENV CODEPOD_DOCKER_NETWORK=codepod-network
ENV CODEPOD_MAX_JOBS=10
ENV CODEPOD_LOG_LEVEL=info

# Mount Docker socket from host
VOLUME ["/var/run/docker.sock"]

ENTRYPOINT ["/app/runner"]
