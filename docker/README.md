# CodePod Docker Deployment

## Quick Start

```bash
# 一键启动所有服务
make docker-up

# 查看日志
make docker-logs

# 查看状态
make docker-status

# 一键停止所有服务
make docker-down

# 重启服务
make docker-restart
```

## Manual Commands

```bash
cd docker

# 启动服务
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down

# 重新构建镜像
docker-compose build --no-cache
docker-compose up -d
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| server | 8080 | REST API Server |
| runner | - | Job Runner (manages Docker sandboxes) |

## Configuration

修改 `docker-compose.yml` 中的环境变量来配置服务。

### Server Environment Variables
- `PORT`: Server port (default: 8080)
- `HOST`: Server host (default: 0.0.0.0)

### Runner Environment Variables
- `CODEPOD_SERVER_URL`: Server gRPC URL
- `CODEPOD_DOCKER_HOST`: Docker socket path
- `CODEPOD_DOCKER_NETWORK`: Docker network name
- `CODEPOD_MAX_JOBS`: Maximum concurrent jobs
- `CODEPOD_LOG_LEVEL`: Log level (debug, info, warn, error)

## Runner Docker Socket

Runner 容器需要访问宿主机的 Docker socket (`/var/run/docker.sock`) 来管理 sandbox 容器。
确保运行时挂载了该路径。
