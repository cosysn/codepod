# Runtime stage - based on ubuntu-builder which has Go, Node.js, Docker
FROM localhost:5000/codepod/ubuntu-builder:latest

# Configure Docker registry mirror
RUN mkdir -p /etc/docker && \
    echo '{"registry-mirrors": ["https://registry.docker-cn.com","https://mirror.ccs.tencentyun.com"]}' > /etc/docker/daemon.json

# Install openssh-client for git clone over SSH
RUN apk add --no-cache openssh-client

# Copy kaniko (using Aliyun mirror for China network)
COPY --from=registry.cn-hangzhou.aliyuncs.com/kaniko-project/executor:latest /kaniko /kaniko

# Copy pre-built envbuilder binary
COPY envbuilder /usr/local/bin/envbuilder

# Ensure envbuilder is executable
RUN chmod +x /usr/local/bin/envbuilder

# Configure Kaniko registry mirror for China network
ENV KANIKO_REGISTRY_MIRROR="registry.docker-cn.com;mirror.ccs.tencentyun.com"

WORKDIR /workspace

# Default command is envbuilder, but users can override with "sh" for shell access
ENTRYPOINT ["/usr/local/bin/envbuilder"]
CMD ["--help"]
