# DevPod SSH 凭证自动复制设计方案

**日期**: 2026-02-23

## 1. 目标

在 `devpod up` 流程中，自动将本地机器的 SSH 密钥和 Git 配置复制到 builder sandbox，解决无法克隆 Git 代码的问题。

## 2. 背景

当前 `devpod up <repo-url>` 流程：
1. 创建 builder sandbox
2. 在 sandbox 内执行 `git clone`
3. 使用 envbuilder 构建镜像
4. 创建 dev sandbox

**问题**: sandbox 内没有用户的 SSH 密钥和 Git 配置，导致：
- HTTPS 克隆可能遇到 SSL 证书问题
- SSH 克隆无法认证
- Git 提交信息缺失

## 3. 方案选择

### 方案对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| 1. SDK + Bind Mount | 一次配置，永久生效 | 需要修改 SDK 和 Runner |
| 2. Base64 传输 | 快速实现，无需 SDK 修改 | 私钥出现在命令历史 |
| 3. 环境变量 | 简单 | 有长度限制，不适用大文件 |

**选择**: 方案 2 (Base64 传输)，实现最快，无需修改 SDK。

## 4. 实现设计

### 4.1 文件清单

| 本地文件 | 远程目标 | 权限 |
|----------|----------|------|
| `~/.ssh/id_rsa` | `/root/.ssh/id_rsa` | 600 |
| `~/.ssh/id_ed25519` | `/root/.ssh/id_ed25519` | 600 |
| `~/.ssh/known_hosts` | `/root/.ssh/known_hosts` | 644 |
| `~/.ssh/config` | `/root/.ssh/config` | 644 |
| `~/.gitconfig` | `/root/.gitconfig` | 644 |

### 4.2 实现流程

```
1. 在 manager.ts 中，builder sandbox 创建成功后
2. 扫描 ~/.ssh 目录
3. 对每个文件：
   a. 读取本地文件内容
   b. base64 编码
   c. 通过 sandbox.commands.run() 传输并写入远程
4. 复制 ~/.gitconfig
5. 设置正确权限
```

### 4.3 核心代码

```typescript
// 新增函数：复制 SSH 凭证到 sandbox
async function copyCredentialsToSandbox(sandbox: Sandbox): Promise<void> {
  const homeDir = os.homedir();
  const sshDir = path.join(homeDir, '.ssh');
  const gitconfigPath = path.join(homeDir, '.gitconfig');

  // 复制 SSH 目录
  if (fs.existsSync(sshDir)) {
    await copyDirectoryWithPermissions(sandbox, sshDir, '/root/.ssh');
  }

  // 复制 .gitconfig
  if (fs.existsSync(gitconfigPath)) {
    await copyFileWithPermissions(sandbox, gitconfigPath, '/root/.gitconfig');
  }
}

// 复制目录并设置权限
async function copyDirectoryWithPermissions(
  sandbox: Sandbox,
  localDir: string,
  remoteDir: string
): Promise<void> {
  // 创建远程目录
  await sandbox.commands.run(`mkdir -p ${remoteDir}`);

  const files = fs.readdirSync(localDir);

  for (const file of files) {
    const localPath = path.join(localDir, file);
    const stat = fs.statSync(localPath);

    // 跳过目录
    if (stat.isDirectory()) continue;

    const remotePath = `${remoteDir}/${file}`;
    await copyFileWithPermissions(sandbox, localPath, remotePath);
  }

  // 设置目录权限
  await sandbox.commands.run(`chmod 700 ${remoteDir}`);
}

// 复制单个文件并设置权限
async function copyFileWithPermissions(
  sandbox: Sandbox,
  localPath: string,
  remotePath: string
): Promise<void> {
  const content = fs.readFileSync(localPath);
  const encoded = content.toString('base64');

  // 使用 printf 避免 echo 换行问题
  await sandbox.commands.run(
    `printf '%s' '${encoded}' | base64 -d > ${remotePath}`
  );

  // 设置权限：私钥 600，其他 644
  const isPrivateKey = localPath.includes('id_rsa') || localPath.includes('id_ed25519');
  const perm = isPrivateKey ? '600' : '644';
  await sandbox.commands.run(`chmod ${perm} ${remotePath}`);
}
```

### 4.4 错误处理

- **文件不存在**: 静默跳过，继续处理其他文件
- **传输失败**: 抛出错误，整个构建失败
- **权限设置失败**: 抛出警告但继续

### 4.5 安全性考虑

- 私钥内容通过 base64 传输，命令历史可见
- 可选：传输后清理命令历史 (`history -c`)
- 传输的是用户已授权的凭证，风险可控

## 5. 文件变更

| 文件 | 变更 |
|------|------|
| `apps/devpod/src/workspace/manager.ts` | 添加 `copyCredentialsToSandbox()` 函数，在 builder sandbox 创建后调用 |

## 6. 测试计划

1. **本地测试**: 有 SSH 密钥和无密钥两种情况
2. **克隆测试**: HTTPS 和 SSH 两种克隆方式
3. **权限测试**: 验证文件权限正确
4. **错误测试**: 文件不存在时的处理

## 7. 后续优化（可选）

- 添加 `--no-git-config` 选项跳过凭证复制
- 支持从环境变量或配置文件指定凭证路径
- 考虑长期方案：修改 SDK 支持 bind mount
