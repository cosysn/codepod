# Agent 端口合并设计 (SSH + gRPC 多路复用)

## 概述

将 Agent 的 SSH 和 gRPC 服务合并到单一端口，通过 cmux 实现协议多路复用。

## 背景

当前 Agent 需要两个端口：
- SSH 端口: 2222 (容器内)
- gRPC 端口: 50052 (容器内)

这导致：
1. 端口管理复杂
2. 需要映射两个端口到宿主机
3. Server 需要记录多个端口

## 目标

1. Agent 只使用单一端口 (默认 2222)
2. 通过 cmux 实现 SSH 和 gRPC 协议复用
3. Server 只记录一个端口
4. 保持向后兼容

## 架构

### 改动前

```
┌─────────────────────────────────────────────┐
│  Agent 容器                                │
│  SSH:2222 ──────► Host:随机端口            │
│  gRPC:50052 ───► Host:随机端口            │
└─────────────────────────────────────────────┘
```

### 改动后

```
┌─────────────────────────────────────────────┐
│  Agent 容器                                │
│  ┌─────────────────────────────────────┐   │
│  │ cmux 多路复用 (端口: 2222)          │   │
│  │  ├── SSH 匹配 (SSH- 前缀)          │   │
│  │  └── gRPC 匹配 (HTTP/2)            │   │
│  └─────────────────────────────────────┘   │
│                    ▼                        │
│           Host:随机端口 (单一)              │
└─────────────────────────────────────────────┘
```

## 改动点

### 1. Agent (sandbox/agent/)

#### 依赖
- 引入 `cmux` 包: `go get github.com/soheilhy/cmux`

#### 配置变更
- 移除 `AGENT_GRPC_PORT` 环境变量
- 保留 `AGENT_SSH_PORT` 作为统一端口 (默认 2222)

#### 代码改动
- 修改 `cmd/main.go`:
  - 创建单一 TCP listener
  - 使用 cmux 复用端口
  - 分别启动 SSH 和 gRPC 服务

```go
// 伪代码
listener, err := net.Listen("tcp", fmt.Sprintf(":%d", cfg.SSH.Port))

m := cmux.New(listener)
// 匹配 SSH - SSH 协议以 "SSH-" 开头
sshListener := m.Match(cmux.Any())
// 匹配 gRPC - HTTP/2
grpcListener := m.Match(cmux.HTTP2())

go sshServer.Serve(sshListener)
go grpcServer.Serve(grpcListener)

m.Serve()
```

### 2. Runner (sandbox/runner/)

#### 环境变量变更
- 移除 `AGENT_GRPC_PORT: "50052"`
- 保留 `AGENT_SSH_PORT: "2222"`

#### 端口映射变更
- 只映射一个端口 (原 SSH 端口)
- 移除 gRPC 端口映射

#### 代码改动
- `runner.go`: 更新 `UpdateSandboxStatus` 调用
- `manager.go`: 移除 AgentPort 相关逻辑

### 3. Server (sandbox/server/)

#### 类型变更
- `types.ts`: 移除 `AgentPort` 字段，只保留 `port`

#### API 变更
- `/connection` 端点简化为返回单一端口
- 移除 `agent-address` 端点 (可选)

#### 存储变更
- `store.ts`: 简化端口更新逻辑

## 测试计划

1. 单元测试: Agent cmux 逻辑
2. 集成测试: 创建 sandbox，验证 SSH 和 gRPC 都可连接
3. 并发测试: 多个 sandbox 并行运行，验证端口不冲突

## 兼容性

- 旧版本 Agent 仍可正常工作 (需要 Server 适配)
- 渐进式升级: 先部署新 Agent，再更新 Server

## 风险

1. cmux 依赖引入额外的复杂性
2. 需要验证 SSH 和 gRPC 性能不受影响
3. 错误处理需要同时考虑两种协议

## 里程碑

1. [ ] Agent 引入 cmux，修改启动逻辑
2. [ ] Runner 移除 gRPC 端口映射
3. [ ] Server 简化端口记录
4. [ ] 修复端口获取 bug (时序问题)
5. [ ] 测试验证
