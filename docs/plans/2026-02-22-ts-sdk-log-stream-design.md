# TS SDK Log Stream 设计文档

## 一、概述

为 TS SDK 增加命令执行实时输出流式回调功能，参考 E2B/Daytona 的接口设计。

## 二、架构

```
┌────────┐  1.获取连接信息   ┌────────┐  2.直连         ┌────────┐
│ TS SDK  │ ─────────────────►  │ Server │  ────────────► │ Agent  │
│        │ ◄─────────────────  │        │ ◄───────────── │        │
└────────┘  (host:port,token)└────────┘  gRPC流式    └────────┘
```

## 三、流程

| 步骤 | 操作 | 说明 |
|------|------|------|
| 1 | Runner 创建容器 | 暴露 SSH(2222) + gRPC(50052) 端口 |
| 2 | Runner 分配端口 | 获取映射后的主机端口 |
| 3 | Runner 推送地址 | `sandboxId → {host:port, token}` 到 Server |
| 4 | SDK 调用 Server | `GET /api/v1/sandboxes/{id}/connection` |
| 5 | SDK 直连 Agent | 使用返回的 host:port + token 建立 gRPC |
| 6 | Agent 执行命令 | fork 子进程，管道传输输出 |

## 四、接口设计

### 4.1 TS SDK 接口（参考 E2B）

```typescript
// 回调函数类型
type OutputCallback = (data: string) => void;

// 执行命令接口
sandbox.commands.run(command: string, options?: {
  onStdout?: OutputCallback;    // stdout 回调
  onStderr?: OutputCallback;    // stderr 回调
  timeout?: number;              // 超时时间（毫秒）
  cwd?: string;                 // 工作目录
}): Promise<CommandResult>;

// CommandResult
interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}
```

### 4.2 Server REST API

```
GET /api/v1/sandboxes/{id}/connection

Response:
{
  "host": "192.168.1.100",
  "port": 32000,
  "token": "xxx"
}
```

### 4.3 gRPC 接口（Agent）

```protobuf
service ExecService {
  // 打开执行会话（多路复用）
  rpc OpenSession(OpenSessionRequest) returns (stream CommandOutput);

  // 执行命令
  rpc Execute(ExecuteRequest) returns (stream CommandOutput);
}

message OpenSessionRequest {
  string sandbox_id = 1;
  string token = 2;
}

message ExecuteRequest {
  string command = 1;
  string cwd = 2;
  map<string, string> env = 3;
  int64 timeout = 4;
}

message CommandOutput {
  string line = 1;
  OutputChannel channel = 2;  // STDOUT / STDERR
  bool end = 3;
  int32 exit_code = 4;
}

enum OutputChannel {
  STDOUT = 0;
  STDERR = 1;
}
```

## 五、特性实现

| 特性 | 实现 |
|------|------|
| **独立回调** | `onStdout` / `onStderr` 分别回调 |
| **多路复用** | gRPC 双向流，单连接可执行多个命令 |
| **反压** | gRPC flow control |
| **链路保活** | gRPC keepalive (keepalive_time_ms, keepalive_timeout_ms) |
| **自动恢复** | gRPC 重连机制 + 重试逻辑 |

## 六、Agent 实现

- 新增 gRPC 服务 (端口 50052)
- 支持多路复用：单连接可执行多个命令
- fork 子进程，通过管道获取 stdout/stderr
- 使用 gRPC flow control 实现反压

## 七、修改文件清单

### Agent
- `sandbox/agent/cmd/main.go` - 新增 gRPC 服务启动
- `sandbox/agent/pkg/grpc/` - 新增 gRPC 服务实现
- `sandbox/agent/pkg/exec/` - 修改执行器支持管道输出

### Server
- `sandbox/server/src/routes/` - 新增 `/api/v1/sandboxes/:id/connection` 端点
- `sandbox/server/src/services/` - 新增连接信息服务

### Runner
- `sandbox/runner/pkg/sandbox/manager.go` - 暴露 gRPC 端口，推送地址到 Server

### TS SDK
- `libs/sdk-ts/src/sandbox/index.ts` - 新增 `commands.run()` 接口
- `libs/sdk-ts/src/client/index.ts` - 新增 `getConnectionInfo()` 方法
