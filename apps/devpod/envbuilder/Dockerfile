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

# Copy kaniko (using Aliyun mirror for China network)
COPY --from=registry.cn-hangzhou.aliyuncs.com/kaniko-project/executor:latest /kaniko /kaniko

# Copy envbuilder
COPY --from=builder /build/envbuilder /usr/local/bin/envbuilder

WORKDIR /workspace

# Default command is envbuilder, but users can override with "sh" for shell access
ENTRYPOINT ["/usr/local/bin/envbuilder"]
CMD ["--help"]
