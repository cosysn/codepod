FROM ubuntu:22.04

# Install development tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    wget \
    vim \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Go
RUN curl -fsSL https://go.dev/dl/go1.22.0-linux-amd64.tar.gz -o /tmp/go.tar.gz \
    && tar -C /usr/local -xzf /tmp/go.tar.gz \
    && rm /tmp/go.tar.gz
ENV PATH="/usr/local/go/bin:${PATH}"
ENV GOPATH="/root/go"

# Install Node.js
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install Go tools
RUN go install golang.org/x/tools/cmd/gopls@latest \
    && go install github.com/codegenie-ai/gotestsum@latest

# Install Node.js tools
RUN npm install -g typescript-language-server eslint prettier

WORKDIR /workspace

COPY .devcontainer/post-create.sh /tmp/
RUN bash /tmp/post-create.sh

CMD ["bash"]
