# DevPod 内置镜像仓库集成实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修改 DevPod 使用内置镜像仓库，从 Server endpoint 自动推导 registry 地址，实现完整的开发容器发放流程。

**Architecture:** DevPod 从配置的 Server endpoint (如 `http://localhost:8080`) 自动推导出内置 registry 地址 (`localhost:8080/registry/v2`)，镜像构建和推送使用该地址。

**Tech Stack:** TypeScript, Node.js, Docker

---

## Task 1: 修改配置管理，从 Server endpoint 推导 Registry 地址

**Files:**
- Modify: `apps/devpod/src/config.ts`

**Step 1: 添加 getRegistry 方法**

从 endpoint 推导 registry 地址的逻辑：
- Server: `http://localhost:8080` → Registry: `localhost:8080/registry/v2`
- 提取 host 和 port，添加 `/registry/v2` 路径

```typescript
// 在 config.ts 中添加新方法

/**
 * 从 Server endpoint 推导内置 registry 地址
 * 例如: http://localhost:8080 → localhost:8080/registry/v2
 */
getRegistryFromEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    const host = url.hostname;
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    return `${host}:${port}/registry/v2`;
  } catch {
    // Fallback to default if endpoint is invalid
    return 'localhost:8080/registry/v2';
  }
}

/**
 * 获取 registry 地址，优先使用配置的 registry，否则从 endpoint 推导
 */
getRegistry(): string {
  const cfg = this.load();
  if (cfg.registry && cfg.registry !== 'localhost:5000') {
    return cfg.registry;
  }
  // 从 endpoint 推导内置 registry
  if (cfg.endpoint) {
    return this.getRegistryFromEndpoint(cfg.endpoint);
  }
  return 'localhost:8080/registry/v2';
}
```

**Step 2: 运行测试验证**

```bash
cd /home/ubuntu/codepod-worktrees/devpod-internal-registry/apps/devpod
npm run build
```

**Step 3: Commit**

```bash
git add apps/devpod/src/config.ts
git commit -m "feat(devpod): derive registry from server endpoint"
```

---

## Task 2: 修改 Workspace Manager 使用推导的 Registry 地址

**Files:**
- Modify: `apps/devpod/src/workspace/manager.ts`

**Step 1: 更新 builder 镜像地址**

当前代码 (第 39-40 行):
```typescript
this.builderImage = `${this.registry}/codepod/builder:latest`;
```

需要确认 builder 镜像是否已经存在于内置 registry 中。如果没有，需要先构建并推送。

**Step 2: 更新镜像构建逻辑**

当前代码 (第 173-185 行):
```typescript
// Build image - use 127.0.0.1 for registry inside container (registry runs on host network)
const dockerfilePath = options.dockerfilePath || '/workspace/repo/.devcontainer/Dockerfile';
const buildRegistry = this.registry.replace('localhost', '127.0.0.1').replace('host.docker.internal', '127.0.0.1');
```

需要修改为：
- 容器内访问 host 的 registry 使用 `host.docker.internal` 或 `host.containers.internal`
- 新路径: `<host>:8080/registry/v2/...`

```typescript
// Builder 容器内访问 registry
// 需要将 localhost 转换为 host.docker.internal
let buildRegistry = this.registry;
if (buildRegistry.includes('localhost') || buildRegistry.match(/^[\d.]+:/)) {
  // localhost or IP address -> host.docker.internal
  buildRegistry = buildRegistry.replace('localhost', 'host.docker.internal');
}

const dockerfilePath = options.dockerfilePath || '/workspace/repo/.devcontainer/Dockerfile';
const buildCmd = `cd /workspace && docker build -f ${dockerfilePath} -t ${buildRegistry}/workspace/${options.name}:latest /workspace/repo`;
```

**Step 3: 更新镜像名称格式**

修改镜像命名从 `devpod/` 改为 `workspace/`:

```typescript
// 第 87 行
imageRef: `${this.registry}/workspace/${name}:latest`

// 第 114 行
devImage = `${this.registry}/workspace/${name}:latest`

// 第 130 行
meta.imageRef = `${this.registry}/workspace/${name}:latest`
```

**Step 4: Commit**

```bash
git add apps/devpod/src/workspace/manager.ts
git commit -m "feat(devpod): use internal registry with derived address"
```

---

## Task 3: 构建并推送 Builder 镜像到内置 Registry

**Files:**
- Modify: `apps/devpod/builder/Dockerfile` (如有需要)

**Step 1: 检查 builder 镜像是否存在**

```bash
# 尝试从内置 registry 拉取 builder 镜像
curl http://localhost:8080/registry/v2/codepod/builder/tags/list
```

如果不存在，需要构建并推送。

**Step 2: 构建并推送 builder 镜像**

```bash
# 构建镜像
docker build -t codepod/builder:latest ./apps/devpod/builder

# Tag 为内置 registry 地址
docker tag codepod/builder:latest localhost:8080/registry/v2/codepod/builder:latest

# 推送
docker push localhost:8080/registry/v2/codepod/builder:latest
```

**Step 3: Commit (可选)**

如果修改了 Dockerfile:

```bash
git add apps/devpod/builder/Dockerfile
git commit -m "chore(devpod): builder image for internal registry"
```

---

## Task 4: 测试完整的 DevPod 工作流

**Files:**
- Test: 端到端测试

**Step 1: 配置 DevPod**

```bash
cd /home/ubuntu/codepod-worktrees/devpod-internal-registry/apps/devpod
npm run build

# 配置 server endpoint
node dist/index.js config set endpoint http://localhost:8080

# 验证配置
cat ~/.devpod/config.json
```

预期输出:
```json
{
  "endpoint": "http://localhost:8080",
  "registry": "localhost:8080/registry/v2"
}
```

**Step 2: 运行 devpod up 测试**

```bash
# 使用一个简单的测试仓库
node dist/index.js up https://github.com/microsoft/vscode-remote-try-node
```

预期流程:
1. 创建 volume
2. 创建 builder sandbox
3. 克隆代码到 volume
4. 构建开发容器镜像
5. 推送到内置 registry
6. 删除 builder sandbox
7. 创建 dev sandbox
8. 输出 sandbox 连接信息

**Step 3: 验证镜像已推送**

```bash
# 查看内置 registry 中的镜像
curl http://localhost:8080/registry/v2/workspace/_catalog
```

**Step 4: 验证 Dev Sandbox 可用**

```bash
# 查看 sandbox 列表
node dist/index.js list

# 尝试 SSH 连接
ssh <user>@<host> -p <port>
```

---

## Task 5: 提交代码

**Step 1: 合并 worktree 更改到 main**

```bash
git checkout main
git merge devpod-internal-registry
```

**Step 2: 推送到远程**

```bash
git push origin main
```

---

## Summary

| Task | Description | Status |
|------|-------------|--------|
| 1 | 修改配置管理，推导 registry 地址 | Pending |
| 2 | 修改 Workspace Manager 使用推导的 registry | Pending |
| 3 | 构建并推送 Builder 镜像 | Pending |
| 4 | 测试完整工作流 | Pending |
| 5 | 提交代码 | Pending |

**Total: 5 tasks**

**Plan complete and saved to `docs/plans/2026-02-21-devpod-internal-registry.md`.**

**Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
