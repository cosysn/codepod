# Build stage (skipped - binary copied from host)
# FROM golang:1.21-alpine AS builder
# RUN CGO_ENABLED=0 GOOS=linux go build -o envbuilder ./cmd

# Runtime stage
FROM alpine:3.19

RUN apk add --no-cache \
    ca-certificates \
    tzdata \
    bash \
    docker \
    curl \
    nano

# Configure Docker registry mirror
RUN mkdir -p /etc/docker && \
    echo '{"registry-mirrors": ["https://registry.docker-cn.com","https://mirror.ccs.tencentyun.com"]}' > /etc/docker/daemon.json

# Copy kaniko (using Aliyun mirror for China network)
COPY --from=registry.cn-hangzhou.aliyuncs.com/kaniko-project/executor:latest /kaniko /kaniko

# Copy pre-built envbuilder binary
COPY envbuilder /usr/local/bin/envbuilder

WORKDIR /workspace

# Default command is envbuilder, but users can override with "sh" for shell access
ENTRYPOINT ["/usr/local/bin/envbuilder"]
CMD ["--help"]
