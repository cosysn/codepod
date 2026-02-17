FROM codepod/base:latest

# 安装开发工具
RUN apt-get update && apt-get install -y \
    git \
    curl \
    wget \
    vim \
    && rm -rf /var/lib/apt/lists/*

# 安装 Go tools
RUN go install golang.org/x/tools/cmd/gopls@latest \
    && go install github.com/codegenie-ai/gotestsum@latest

# 安装 Node.js tools
RUN npm install -g typescript-language-server eslint prettier

WORKDIR /workspace

COPY .devcontainer/post-create.sh /tmp/
RUN bash /tmp/post-create.sh

CMD ["bash"]
