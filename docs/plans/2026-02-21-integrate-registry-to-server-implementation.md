# 将内置镜像仓库集成到 Server 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 Docker Registry V2 镜像仓库集成到主 Server，通过 `/registry/v2` 路径访问。

**Architecture:** 将 server.ts 从原生 http 改为 Express，挂载 Registry 路由到 `/registry/v2` 前缀。

**Tech Stack:** TypeScript, Express.js, Node.js

---

## Task 1: 修改 Registry 路由前缀

**Files:**
- Modify: `sandbox/server/src/registry/routes/v2.ts:35`
- Modify: `sandbox/server/src/registry/server.ts:35`

**Step 1: 修改 v2.ts 路由前缀**

将：
```typescript
app.use('/v2', v2Router);
```
改为：
```typescript
app.use('/registry/v2', v2Router);
```

**Step 2: 修改 registry/server.ts 路由前缀**

将：
```typescript
app.use('/v2', v2Router);
```
改为：
```typescript
app.use('/registry/v2', v2Router);
```

**Step 3: Commit**

```bash
git add sandbox/server/src/registry/routes/v2.ts sandbox/server/src/registry/server.ts
git commit -m "feat(registry): change route prefix to /registry/v2"
```

---

## Task 2: 将 server.ts 改为 Express

**Files:**
- Modify: `sandbox/server/src/server.ts`

**Step 1: 添加 Express 导入**

在文件顶部添加：
```typescript
import express, { Request, Response, NextFunction } from 'express';
```

**Step 2: 创建 Express app**

在现有代码后添加：
```typescript
const app = express();

// Raw body for registry blob uploads
app.use('/registry/v2', express.raw({ type: '*/*', limit: '10gb' }));

// JSON parsing for API routes
app.use(express.json());

// CORS middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, X-Runner-Id, Accept');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});
```

**Step 3: 将现有路由转换为 Express 路由**

将现有的 handleRequest 函数逻辑保留，但用 Express 路由方式实现。

**Step 4: 挂载 Registry 路由**

在 app 配置后添加：
```typescript
import { v2Router } from './registry/routes/v2';
app.use('/registry/v2', v2Router);
```

**Step 5: 启动时使用 Express app**

将：
```typescript
const server = httpCreateServer(handleRequest);
```
改为：
```typescript
import { createServer as httpCreateServer } from 'http';
const server = httpCreateServer(app);
```

**Step 6: Commit**

```bash
git add sandbox/server/src/server.ts
git commit -m "refactor(server): convert to Express for registry integration"
```

---

## Task 3: 更新测试

**Files:**
- Test: `sandbox/server/src/registry/routes/v2.test.ts`

**Step 1: 更新测试中的路由前缀**

将测试中的 `/v2/` 路径改为 `/registry/v2/`

**Step 2: 运行测试**

```bash
cd sandbox/server && npm test -- --testPathPattern="registry"
```

**Step 3: Commit**

```bash
git add sandbox/server/src/registry/routes/v2.test.ts
git commit -m "test(registry): update test routes for /registry/v2 prefix"
```

---

## Task 4: 验证端到端

**Step 1: 启动 Server**

```bash
cd sandbox/server && npm run dev
```

**Step 2: 测试 Registry API**

```bash
# 测试健康检查
curl http://localhost:8080/health

# 测试 Registry API
curl http://localhost:8080/registry/v2/
# 期望返回: {"version":"2.0","name":"codepod-registry"}

# 测试镜像推送
docker tag hello-world localhost:8080/registry/v2/test:latest
docker push localhost:8080/registry/v2/test:latest
```

**Step 3: Commit**

---

## Summary

| Task | Description | Status |
|------|-------------|--------|
| 1 | 修改 Registry 路由前缀 | Pending |
| 2 | 将 server.ts 改为 Express | Pending |
| 3 | 更新测试 | Pending |
| 4 | 验证端到端 | Pending |

**Total: 4 tasks**
