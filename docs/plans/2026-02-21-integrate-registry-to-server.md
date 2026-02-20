# 将内置镜像仓库集成到 Server 设计方案

## 概述

将内置的 Docker Registry V2 镜像仓库集成到主 Server 中，使用统一端口（8080），通过 `/registry/v2` 路径访问。

## 架构

```
┌─────────────────────────────────────────────────────┐
│                  CodePod Server                      │
│  ┌─────────────────┐  ┌──────────────────────────┐  │
│  │  REST API       │  │   Registry (Docker V2)   │  │
│  │  /api/v1/*      │  │   /registry/v2/*         │  │
│  └─────────────────┘  └──────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

## 路由设计

| 路径 | 说明 |
|------|------|
| `/api/v1/*` | 现有 REST API |
| `/registry/v2/*` | Docker Registry V2 API |
| `/health` | 健康检查 |

## 实现步骤

1. 将 server.ts 从原生 http 改为 Express
2. 修改 Registry 路由前缀从 `/v2` 改为 `/registry/v2`
3. 在主 Server 中注册 Registry 路由
4. 处理 Registry 需要的 raw body 支持
5. 更新相关配置

## 环境变量

- `CODEPOD_REGISTRY_ENABLED=true` - 启用内置 Registry（默认启用）

## 兼容性

- Runner 拉取镜像时使用完整路径：`server:8080/registry/v2/...`
- Docker 客户端可以通过 `localhost:8080/registry/v2/...` 访问
