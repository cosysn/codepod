# TS SDK Examples 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 创建 TS SDK 示例代码，模仿 E2B 接口设计，并端到端验证 SDK 功能。

**Architecture:** 模仿 E2B 的 `Sandbox.create()` 接口，创建示例展示如何执行命令并获取输出。

**Tech Stack:** TypeScript, Docker, CodePod SDK

---

## Task 1: 重建 Docker 环境

**Files:**
- Modify: `docker/docker-compose.yml` (如需要)

**Step 1: 停止现有容器**

```bash
cd /home/ubuntu/codepod/docker
docker-compose down
```

**Step 2: 重新构建镜像**

```bash
docker-compose build --no-cache
```

**Step 3: 启动服务**

```bash
docker-compose up -d
```

**Step 4: 等待服务就绪**

```bash
curl -s http://localhost:8080/health
```

**Step 5: Commit**

```bash
git add docker/ && git commit -m "chore: rebuild Docker images"
```

---

## Task 2: 创建示例代码

**Files:**
- Create: `libs/sdk-ts/examples/run-command.ts`
- Create: `libs/sdk-ts/examples/tsconfig.json`

**Step 1: 创建示例目录**

```bash
mkdir -p libs/sdk-ts/examples
```

**Step 2: 创建示例代码（模仿 E2B 风格）**

```typescript
// libs/sdk-ts/examples/run-command.ts
import { Sandbox } from '../src';

async function main() {
  // 创建 sandbox
  const sandbox = await Sandbox.create({
    timeout: 60_000,
  });

  console.log('Sandbox created:', sandbox.id);

  // 执行命令
  const result = await sandbox.commands.run('npm install', {
    onStdout: (data) => console.log('[stdout]', data),
    onStderr: (data) => console.error('[stderr]', data),
    timeout: 60_000,
  });

  console.log('Exit code:', result.exitCode);
  console.log('stdout:', result.stdout);
  console.log('stderr:', result.stderr);

  // 删除 sandbox
  await sandbox.delete();
}

main().catch(console.error);
```

**Step 3: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist"
  },
  "include": ["*.ts"]
}
```

**Step 4: Commit**

```bash
git add libs/sdk-ts/examples/ && git commit -m "feat(sdk-ts): add examples"
```

---

## Task 3: 运行示例验证

**Files:**
- Modify: `libs/sdk-ts/package.json` (添加 example 脚本)

**Step 1: 安装依赖**

```bash
cd libs/sdk-ts
npm install
npm run build
```

**Step 2: 运行示例**

```bash
cd libs/sdk-ts/examples
npx ts-node run-command.ts
```

**Step 3: 验证输出**

- 确认 sandbox 创建成功
- 确认 `npm install` 输出显示在 stdout 回调
- 确认 exitCode 为 0

**Step 4: Commit**

```bash
git add libs/sdk-ts/ && git commit -m "test(sdk-ts): verify examples work"
```

---

## Task 4: 添加更多示例（可选）

**Files:**
- Create: `libs/sdk-ts/examples/environment-vars.ts` - 环境变量示例
- Create: `libs/sdk-ts/examples/timeout-handling.ts` - 超时处理示例

---

## 执行顺序

1. Task 1: 重建 Docker 环境
2. Task 2: 创建示例代码
3. Task 3: 运行示例验证

---

Plan complete and saved to `docs/plans/2026-02-22-ts-sdk-examples.md`.

**Two execution options:**

1. **Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

2. **Parallel Session (separate)** - Open new session with executing_plans, batch execution with checkpoints

Which approach?
