# envbuilder runtime image - based on alpine for minimal size
FROM docker.io/library/alpine:3.19

# Install required tools
RUN apk add --no-cache \
    openssh-client \
    ca-certificates \
    git \
    curl \
    bash

# Copy kaniko (using Aliyun mirror for China network)
COPY --from=registry.cn-hangzhou.aliyuncs.com/kaniko-project/executor:latest /kaniko /kaniko

# Copy pre-built envbuilder binary
COPY envbuilder /usr/local/bin/envbuilder

RUN chmod +x /usr/local/bin/envbuilder

# Create entrypoint wrapper to allow shell access and pass through commands
RUN echo '#!/bin/bash' > /entrypoint.sh && \
    echo 'if [ "$1" = "shell" ]; then exec /bin/bash; fi' >> /entrypoint.sh && \
    echo 'if [ "$1" = "sleep" ] || [ "$1" = "/bin/sh" ]; then exec "$@"; fi' >> /entrypoint.sh && \
    echo 'exec /usr/local/bin/envbuilder "$@"' >> /entrypoint.sh && \
    chmod +x /entrypoint.sh

WORKDIR /workspace

ENTRYPOINT ["/entrypoint.sh"]
CMD ["sleep", "infinity"]
