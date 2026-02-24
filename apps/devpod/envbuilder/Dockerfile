# envbuilder runtime image - based on alpine for minimal size
FROM alpine:3.19

# Install required tools
RUN apk add --no-cache \
    openssh-client \
    ca-certificates \
    git \
    curl

# Copy kaniko (using Aliyun mirror for China network)
COPY --from=registry.cn-hangzhou.aliyuncs.com/kaniko-project/executor:latest /kaniko /kaniko

# Copy pre-built envbuilder binary
COPY envbuilder /usr/local/bin/envbuilder

RUN chmod +x /usr/local/bin/envbuilder

WORKDIR /workspace

ENTRYPOINT ["/usr/local/bin/envbuilder"]
CMD ["--help"]
