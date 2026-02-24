# DevPod Dockerfile 镜像配置问题解决方案

## 问题背景

### 1. 环境要求
- 所有 Dockerfile 不依赖内置镜像仓库的镜像
- 只有使用 devpod up 制作的镜像才推送到内置仓库
- 使用外部镜像仓库（腾讯云）作为镜像源

### 2. 遇到的问题

#### 问题一：测试环境网络限制
- 无法访问 Docker Hub (registry-1.docker.io)
- 解决方案：配置 Docker 镜像代理

```bash
# 配置 Docker 镜像代理
mkdir -p /etc/docker
cat > /etc/docker/daemon.json << 'EOF'
{
  "registry-mirrors": ["https://registry.docker-cn.com", "https://mirror.ccs.tencentyun.com"]
}
EOF
systemctl restart docker
```

#### 问题二：Kaniko 无法连接内置仓库
- 容器内 localhost 解析为 IPv6 (::1)，导致无法连接
- 解决方案：使用 registry 的 IP 地址推送镜像

```bash
# 获取 registry 容器 IP
docker inspect codepod-registry --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'
# 例如：172.18.0.3

# 使用 IP 地址推送
envbuilder build --workspace /workspace \
  --image 172.18.0.3:5000/codepod/devcontainer:v15 \
  --registry 172.18.0.3:5000
```

#### 问题三：阿里云镜像仓库需要认证
- registry.cn-hangzhou.aliyuncs.com 需要登录认证
- 解决方案：使用腾讯云镜像仓库（无需认证）

### 3. 最终配置

#### .devcontainer/Dockerfile
```dockerfile
FROM mirror.ccs.tencentyun.com/library/node:20-alpine

# Install tools
RUN apk add --no-cache curl git vim bash

WORKDIR /workspace
```

#### .devcontainer/devcontainer.json
```json
{
  "name": "CodePod Development",
  "image": "node:20-alpine",
  ...
}
```

#### apps/devpod/envbuilder/Dockerfile
```dockerfile
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
```

### 4. 构建步骤

#### 步骤一：构建 envbuilder 镜像并推送到内置仓库
```bash
# 构建镜像
docker build -t localhost:5000/codepod/envbuilder:latest \
  -f apps/devpod/envbuilder/Dockerfile \
  apps/devpod/envbuilder

# 推送镜像
docker push localhost:5000/codepod/envbuilder:latest
```

#### 步骤二：使用 envbuilder 构建 devcontainer 镜像
```bash
# 拉取基础镜像（腾讯云）
docker pull mirror.ccs.tencentyun.com/library/node:20-alpine

# 创建构建容器
docker run -d --name envbuilder-test \
  --network codepod-network \
  -v /tmp/codepod:/workspace \
  localhost:5000/codepod/envbuilder:latest

# 构建并推送（使用 registry IP）
docker exec envbuilder-test envbuilder build \
  --workspace /workspace \
  --image 172.18.0.3:5000/codepod/devcontainer:v15 \
  --registry 172.18.0.3:5000
```

### 5. 推送的内置镜像

| 镜像 | 说明 |
|------|------|
| localhost:5000/codepod/envbuilder:latest | envbuilder 运行时 |
| localhost:5000/codepod/devcontainer:v15 | devcontainer 镜像 |

### 6. 注意事项

1. **网络要求**：构建环境需要能访问外部镜像仓库（腾讯云）
2. **仓库地址**：使用 registry 的 IP 地址而非 localhost
3. **镜像大小**：优先使用 alpine 基础镜像以减小体积
