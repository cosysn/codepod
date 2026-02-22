# Build stage
FROM golang:1.21-alpine AS builder

RUN apk add --no-cache git

WORKDIR /build

COPY go.mod go.sum ./
# Skip download - using vendor

COPY . .

# Build with vendor
RUN CGO_ENABLED=0 GOOS=linux go build -mod=vendor -o envbuilder ./cmd

# Runtime stage
FROM alpine:3.19

RUN apk add --no-cache \
    ca-certificates \
    tzdata \
    bash \
    docker \
    curl

# Note: Kaniko should be installed separately or mount from host
# COPY --from=ghcr.io/kaniko-project/executor:latest /kaniko /kaniko

# Copy envbuilder
COPY --from=builder /build/envbuilder /usr/local/bin/envbuilder

# Create placeholder for kaniko (will be mounted or installed)
RUN mkdir -p /kaniko

WORKDIR /workspace

ENTRYPOINT ["/usr/local/bin/envbuilder"]
CMD ["--help"]
