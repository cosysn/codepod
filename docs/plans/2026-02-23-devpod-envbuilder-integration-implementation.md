# DevPod envbuilder 集成实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 envbuilder 集成到 DevPod up 流程中，使用 Kaniko 构建镜像，通过 TS-SDK command run 接口执行命令并实时输出日志

**Architecture:**
- 更新 builder 镜像，预置 envbuilder 二进制并配置 KANIKO_REGISTRY_MIRROR
- 修改 workspace manager 使用 sandbox.commands.run() 替代 SSH
- 使用 onStdout/onStderr 回调实时输出构建日志

**Tech Stack:** TypeScript, TS-SDK, envbuilder (Kaniko), gRPC

---

## Task 1: 更新 builder 镜像 Dockerfile

**Files:**
- Modify: `apps/devpod/envbuilder/Dockerfile`

**Step 1: 修改 Dockerfile 添加 envbuilder 二进制复制和 KANIKO_REGISTRY_MIRROR**

```dockerfile
# 在适当位置添加
COPY envbuilder /usr/local/bin/envbuilder

# 添加 KANIKO_REGISTRY_MIRROR 环境变量（在中国网络使用）
ENV KANIKO_REGISTRY_MIRROR="registry.docker-cn.com;mirror.ccs.tencentyun.com"
```

**Step 2: 验证 Dockerfile 语法**

Run: `cat apps/devpod/envbuilder/Dockerfile`
Expected: 包含 envbuilder 复制和 KANIKO_REGISTRY_MIRROR 环境变量

**Step 3: Commit**

```bash
git add apps/devpod/envbuilder/Dockerfile
git commit -m "feat(devpod): add envbuilder binary and registry mirror to builder image"
```

---

## Task 2: 更新 devcontainer 配置使用新 builder 镜像

**Files:**
- Modify: `.devcontainer/Dockerfile`
- Modify: `.devcontainer/devcontainer.json`

**Step 1: 更新 devcontainer.json 中的镜像版本**

```json
{
  "image": "10.0.0.15:5000/codepod/devcontainer:v11"
}
```

**Step 2: 验证配置**

Run: `cat .devcontainer/devcontainer.json | grep image`
Expected: 包含新的镜像版本

**Step 3: Commit**

```bash
git add .devcontainer/devcontainer.json
git commit -m "chore: update devcontainer to use new builder image v11"
```

---

## Task 3: 修改 workspace manager 使用 sandbox.commands.run()

**Files:**
- Modify: `apps/devpod/src/workspace/manager.ts`

**Step 1: 添加 runCommandWithLogs 辅助函数**

```typescript
async function runCommandWithLogs(
  sandbox: Sandbox,
  cmd: string,
  options?: { timeout?: number; cwd?: string }
): Promise<number> {
  return new Promise((resolve, reject) => {
    let exitCode = 0;
    sandbox.commands.run(cmd, {
      timeout: options?.timeout || 600000,
      cwd: options?.cwd,
      onStdout: (data) => process.stdout.write(data),
      onStderr: (data) => process.stderr.write(data)
    }).then(result => {
      exitCode = result.exitCode;
      if (exitCode !== 0) {
        reject(new Error(`Command failed with exit code ${exitCode}`));
      } else {
        resolve(exitCode);
      }
    }).catch(reject);
  });
}
```

**Step 2: 修改 buildImage 方法**

将 SSH 执行替换为：

```typescript
private async buildImage(
  sandbox: Sandbox,
  volumeId: string,
  options: BuildOptions
): Promise<void> {
  try {
    // Clone repository
    console.log('Cloning repository...');
    const cloneCmd = `git clone --depth 1 ${options.repoUrl} /workspace/repo`;
    await runCommandWithLogs(sandbox, cloneCmd);

    // Build image with envbuilder
    const dockerfilePath = options.dockerfilePath || '/workspace/repo/.devcontainer/Dockerfile';
    const containerRegistry = this.resolveRegistryForContainer(this.registry);
    const imageName = `workspace/${options.name}:latest`;
    const fullImageName = `${containerRegistry}/${imageName}`;

    console.log('Building image with envbuilder...');
    const buildCmd = `envbuilder build --workspace /workspace/repo --image ${fullImageName} --push`;
    await runCommandWithLogs(sandbox, buildCmd, { cwd: '/workspace' });

    console.log('Image built successfully!');

  } finally {
    // gRPC connection will be closed automatically
  }
}
```

**Step 3: 删除 SSHService 导入和使用**

移除：
```typescript
import { SSHService } from '../services/ssh';
```

**Step 4: 验证 TypeScript 编译**

Run: `cd apps/devpod && npx tsc --noEmit`
Expected: 无错误输出

**Step 5: Commit**

```bash
git add apps/devpod/src/workspace/manager.ts
git commit -m "feat(devpod): use sandbox.commands.run() for build instead of SSH"
```

---

## Task 4: 构建并推送新 builder 镜像

**Step 1: 在 devcontainer 中构建 envbuilder**

```bash
docker exec codepod-build sh -c "export GOPROXY=https://goproxy.cn,direct && cd /workspace/apps/devpod/envbuilder && go build -buildvcs=false -o /workspace/envbuilder ./cmd"
```

**Step 2: 复制 envbuilder 到正确位置**

```bash
cp /home/ubuntu/codepod/build/envbuilder /home/ubuntu/codepod/apps/devpod/envbuilder/
```

**Step 3: 构建 builder 镜像**

```bash
cd /home/ubuntu/codepod/apps/devpod/envbuilder && docker build -t 10.0.0.15:5000/codepod/devcontainer:v11 .
```

**Step 4: 推送镜像到 registry**

```bash
docker push 10.0.0.15:5000/codepod/devcontainer:v11
```

**Step 5: Commit Dockerfile 变更**

```bash
git add apps/devpod/envbuilder/Dockerfile
git commit -m "feat: add envbuilder to builder image"
```

---

## Task 5: 测试集成

**Step 1: 构建 devpod CLI**

```bash
cd apps/devpod && npm run build
```

**Step 2: 验证 CLI 构建成功**

Run: `ls -la apps/devpod/dist/`
Expected: 包含编译后的 JS 文件

**Step 3: 本地测试 up 命令（可选，需要 CodePod server 运行）**

```bash
cd apps/devpod && node dist/index.js up https://github.com/example/repo --name test-workspace
```

---

## Task 6: 提交所有变更

```bash
git add .
git commit -m "feat(devpod): integrate envbuilder with Kaniko for Docker-free builds

- Add envbuilder binary to builder image
- Configure KANIKO_REGISTRY_MIRROR for China network
- Use sandbox.commands.run() instead of SSH
- Stream build logs to console in real-time"

git push
```
