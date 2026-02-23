# DevPod envbuilder 集成设计文档

**日期**: 2026-02-23

## 1. 目标

将 envbuilder 集成到 DevPod up 流程中，使用 Kaniko 构建镜像（无需 Docker daemon），通过 TS-SDK 的 command run 接口执行命令并实时输出日志。

## 2. 架构变更

### 2.1 Builder 镜像更新

- 预置 envbuilder 二进制到 builder 镜像
- 添加 `KANIKO_REGISTRY_MIRROR` 环境变量用于镜像仓库加速

### 2.2 命令执行变更

```typescript
// 当前（使用 SSH）
const ssh = await SSHService.connectWithPassword(...);
await ssh.exec(cloneCmd);

// 变更后（使用 TS-SDK gRPC）
const sandbox = await createSandboxAndWait(...);
await sandbox.commands.run(cloneCmd, {
  onStdout: (data) => process.stdout.write(data),
  onStderr: (data) => process.stderr.write(data)
});
```

### 2.3 日志流输出

- 使用 `onStdout` 回调实时输出 git clone 日志
- 使用 `onStdout` 回调实时输出 envbuilder 构建日志
- 超时时间增加到 600 秒（构建镜像可能较慢）

### 2.4 构建命令（简化版）

```bash
# envbuilder 自动解析 .devcontainer/devcontainer.json
envbuilder build --workspace /workspace --image ${fullImageName} --push
```

envbuilder 会自动：
- 解析 `.devcontainer/devcontainer.json`
- 查找 Dockerfile（从配置或默认位置）
- 使用 Kaniko 构建镜像
- 推送到镜像仓库

## 3. 文件变更

| 文件 | 变更 |
|------|------|
| `apps/devpod/envbuilder/Dockerfile` | 添加 envbuilder 二进制复制、添加 KANIKO_REGISTRY_MIRROR |
| `apps/devpod/src/workspace/manager.ts` | 替换 SSH 为 `sandbox.commands.run()`，使用 log stream |
| `.devcontainer/Dockerfile` | 更新 builder 镜像版本 |

## 4. 错误处理

- envbuilder 返回非零退出码时直接报错
- 不提供 Docker 构建降级

## 5. 构建流程

1. 创建共享卷
2. 创建 builder sandbox（使用新的 builder 镜像）
3. 通过 `sandbox.commands.run()` 执行 git clone（log stream 输出）
4. 通过 `sandbox.commands.run()` 执行 envbuilder build（log stream 输出）
5. 销毁 builder sandbox
6. 创建 dev sandbox
