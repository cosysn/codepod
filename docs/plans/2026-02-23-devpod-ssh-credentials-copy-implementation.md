# DevPod SSH 凭证复制实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 devpod up 流程中自动将本地 SSH 密钥和 Git 配置复制到 builder sandbox，解决无法克隆 Git 代码的问题。

**Architecture:** 在 manager.ts 中，builder sandbox 创建成功后，扫描本地 ~/.ssh 目录和 ~/.gitconfig，使用 base64 编码通过 sandbox.commands.run() 传输到远程并设置正确权限。

**Tech Stack:** TypeScript, Node.js fs/path 模块, Base64 编码

---

## 实现计划

### Task 1: 添加凭证复制函数

**Files:**
- Modify: `apps/devpod/src/workspace/manager.ts`

**Step 1: 添加 fs 和 path 导入**

在文件顶部添加导入：

```typescript
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
```

注意：`Sandbox` 类型已在文件顶部导入，只需添加 `fs` 和 `os`。

**Step 2: 添加 copyCredentialsToSandbox 函数**

在 manager.ts 文件末尾添加新函数：

```typescript
/**
 * Copy SSH credentials and gitconfig from local machine to sandbox
 */
async function copyCredentialsToSandbox(sandbox: Sandbox): Promise<void> {
  const homeDir = os.homedir();
  const sshDir = path.join(homeDir, '.ssh');
  const gitconfigPath = path.join(homeDir, '.gitconfig');

  console.log('Copying SSH credentials to sandbox...');

  // Copy SSH directory
  if (fs.existsSync(sshDir)) {
    await copyDirectoryWithPermissions(sandbox, sshDir, '/root/.ssh');
  }

  // Copy .gitconfig
  if (fs.existsSync(gitconfigPath)) {
    await copyFileWithPermissions(sandbox, gitconfigPath, '/root/.gitconfig');
  }

  console.log('SSH credentials copied successfully');
}

/**
 * Copy directory contents and set permissions
 */
async function copyDirectoryWithPermissions(
  sandbox: Sandbox,
  localDir: string,
  remoteDir: string
): Promise<void> {
  // Create remote directory
  await sandbox.commands.run(`mkdir -p ${remoteDir}`);

  const files = fs.readdirSync(localDir);

  for (const file of files) {
    const localPath = path.join(localDir, file);
    const stat = fs.statSync(localPath);

    // Skip directories
    if (stat.isDirectory()) continue;

    const remotePath = `${remoteDir}/${file}`;
    await copyFileWithPermissions(sandbox, localPath, remotePath);
  }

  // Set directory permissions
  await sandbox.commands.run(`chmod 700 ${remoteDir}`);
}

/**
 * Copy single file and set permissions
 */
async function copyFileWithPermissions(
  sandbox: Sandbox,
  localPath: string,
  remotePath: string
): Promise<void> {
  const content = fs.readFileSync(localPath);
  const encoded = content.toString('base64');

  // Use printf to avoid echo newline issues
  await sandbox.commands.run(
    `printf '%s' '${encoded}' | base64 -d > ${remotePath}`
  );

  // Set permissions: private keys 600, others 644
  const isPrivateKey = localPath.includes('id_rsa') || localPath.includes('id_ed25519');
  const perm = isPrivateKey ? '600' : '644';
  await sandbox.commands.run(`chmod ${perm} ${remotePath}`);
}
```

**Step 3: 在 buildImage 方法中调用凭证复制**

在 `buildImage` 方法中，创建 builder sandbox 后、git clone 前添加调用：

```typescript
// Around line 72, after builder sandbox is created
console.log(`Builder sandbox created: ${builder.id}`);

// ADD THIS: Copy SSH credentials before git clone
await copyCredentialsToSandbox(builder);
console.log('');
```

**Step 4: 验证构建通过**

运行 TypeScript 编译检查：
```bash
cd apps/devpod && npx tsc --noEmit
```

预期：无编译错误

**Step 5: 提交**
```bash
git add apps/devpod/src/workspace/manager.ts
git commit -m "feat(devpod): copy SSH credentials to builder sandbox

- Add copyCredentialsToSandbox function to copy ~/.ssh and ~/.gitconfig
- Use base64 encoding to transfer files via sandbox.commands.run()
- Set correct file permissions (600 for private keys, 644 for others)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## 测试计划

### 本地测试

1. **构建 TypeScript**:
   ```bash
   cd apps/devpod && npm run build
   ```

2. **手动测试**:
   - 运行 `devpod up <repo-url>`（使用 SSH 克隆的仓库）
   - 验证 git clone 成功
   - 验证凭证文件存在于 sandbox 中

---

## 执行选择

**Plan complete and saved to `docs/plans/2026-02-23-devpod-ssh-credentials-copy-implementation.md`. Two execution options:**

1. **Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

2. **Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
