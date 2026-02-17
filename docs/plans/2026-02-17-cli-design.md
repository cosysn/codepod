# CodePod CLI Design

## 1. Overview

CLI 是 CodePod 的命令行客户端，用于管理 Sandbox、连接开发环境、执行代码。

### 1.1 主要职责

- **Sandbox 管理**：创建、删除、列出、查看状态
- **SSH 连接**：一键连接到 Sandbox
- **镜像管理**：列出可用镜像
- **配置管理**：API Key 配置、默认选项
- **交互模式**：REPL 模式执行代码

### 1.2 技术栈

- **运行时**：Node.js 20 LTS
- **CLI 框架**：commander.js + inquirer.js
- **HTTP 客户端**：axios + retry
- **SSH 客户端**：ssh2 + node-pty
- **日志输出**：chalk + ora
- **配置安全**：crypto (AES-256 加密)

---

## 2. 架构设计

### 2.1 模块结构

```
apps/cli/
├── src/
│   ├── index.ts                    # CLI 入口
│   ├── config.ts                   # 配置管理
│   │
│   ├── commands/
│   │   ├── sandbox/
│   │   │   ├── create.ts          # 创建 Sandbox
│   │   │   ├── list.ts            # 列出 Sandbox
│   │   │   ├── get.ts             # 获取 Sandbox 信息
│   │   │   ├── delete.ts          # 删除 Sandbox
│   │   │   ├── ssh.ts             # SSH 连接
│   │   │   ├── stop.ts            # 停止 Sandbox
│   │   │   └── restart.ts         # 重启 Sandbox
│   │   │
│   │   ├── image/
│   │   │   └── list.ts            # 列出镜像
│   │   │
│   │   ├── snapshot/
│   │   │   ├── create.ts          # 创建快照
│   │   │   ├── list.ts            # 列出快照
│   │   │   └── restore.ts         # 恢复快照
│   │   │
│   │   ├── key/
│   │   │   ├── list.ts            # 列出 API Keys
│   │   │   └── create.ts          # 创建 API Key
│   │   │
│   │   └── completion.ts           # Shell 补全
│   │
│   ├── services/
│   │   ├── api.ts                 # API 客户端
│   │   ├── sandbox.ts             # Sandbox 服务
│   │   ├── ssh.ts                 # SSH 连接服务
│   │   └── config.ts              # 配置服务
│   │
│   ├── utils/
│   │   ├── logger.ts              # 日志工具
│   │   ├── format.ts              # 格式化工具
│   │   └── spinner.ts             # 加载动画
│   │
│   └── repl/
│       ├── index.ts               # REPL 入口
│       ├── client.ts              # REPL 客户端
│       └── history.ts             # 历史记录
│
├── bin/
│   └── codepod                   # 可执行文件
│
├── package.json
├── tsconfig.json
└── README.md
```

### 2.2 数据流

```
┌─────────────────────────────────────────────────────────────────┐
│                          User CLI                                  │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Commander.js                               │
│  ┌───────────┐ ┌───────────┐ ┌───────────────────────────────┐  │
│  │ Command   │ │ Option    │ │ Argument                      │  │
│  │ Parser    │ │ Parser    │ │ Parser                        │  │
│  └───────────┘ └───────────┘ └───────────────────────────────┘  │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Command Handlers                            │
│  ┌───────────┐ ┌───────────┐ ┌───────────────────────────────┐  │
│  │ Sandbox   │ │ SSH       │ │ Image/Key/etc                │  │
│  │ Commands  │ │ Commands  │ │ Commands                      │  │
│  └─────┬─────┘ └─────┬─────┘ └───────────────────────────────┘  │
└────────┼─────────────┼───────────────────────────────────────────┘
         │             │
         ▼             ▼
┌─────────────────────────────────────────────────────────────────┐
│                       API Service                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  axios Client                                               │  │
│  │  - Automatic retry                                          │  │
│  │  - Token refresh                                            │  │
│  │  - Error handling                                           │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Server (REST API)                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. 命令设计

### 3.1 全局命令

```bash
# 查看版本
codepod --version

# 帮助信息
codepod --help

# 设置 API Key
codepod config set API_KEY <key>

# 查看当前配置
codepod config show

# 设置默认选项
codepod config set default.timeout 3600
codepod config set default.region us-east-1
```

### 3.2 Sandbox 命令

```bash
# 创建 Sandbox
codepod sandbox create [name] \
  --image python:3.11 \
  --cpu 2 \
  --memory 2Gi \
  --timeout 3600 \
  --env FOO=bar

# 列出所有 Sandbox
codepod sandbox list \
  --status running \
  --limit 20

# 获取 Sandbox 详情
codepod sandbox get <id>

# SSH 连接到 Sandbox
codepod sandbox ssh <id>
codepod sandbox ssh <id> --command "ls -la"
codepod sandbox ssh <id> --execute "python script.py"

# 删除 Sandbox
codepod sandbox delete <id>
codepod sandbox delete <id> --force

# 停止 Sandbox
codepod sandbox stop <id>

# 重启 Sandbox
codepod sandbox restart <id>

# 查看 Sandbox 日志
codepod sandbox logs <id>
codepod sandbox logs <id> --follow

# 实时指标
codepod sandbox metrics <id>
```

### 3.3 镜像命令

```bash
# 列出可用镜像
codepod image list

# 列出镜像标签
codepod image tags python
```

### 3.4 快照命令

```bash
# 创建快照
codepod snapshot create <sandbox_id> <name> \
  --description "Backup before changes"

# 列出快照
codepod snapshot list <sandbox_id>

# 恢复快照
codepod snapshot restore <sandbox_id> <snapshot_id>

# 删除快照
codepod snapshot delete <sandbox_id> <snapshot_id>
```

### 3.5 API Key 命令

```bash
# 列出 API Keys
codepod key list

# 创建 API Key
codepod key create "My Key" \
  --expires 2026-12-31
```

### 3.6 REPL 模式

```bash
# 进入交互模式
codepod repl <sandbox_id>

# 在 REPL 中执行代码
> import sys
> print(sys.version)
> result = 1 + 2
> print(result)
```

---

## 4. 核心实现

### 4.1 CLI 入口

```typescript
// src/index.ts

import { Command } from 'commander';
import { configCommand } from './commands/config';
import { sandboxCommand } from './commands/sandbox';
import { imageCommand } from './commands/image';
import { snapshotCommand } from './commands/snapshot';
import { keyCommand } from './commands/key';
import { replCommand } from './commands/repl';
import { version } from '../package.json';

const program = new Command();

program
  .name('codepod')
  .description('CodePod CLI - Sandbox management and code execution')
  .version(version)
  .option('--server <url>', 'Server URL', 'http://localhost:3000')
  .option('--api-key <key>', 'API Key')
  .configureOutput({
    writeOut: (str) => process.stdout.write(str),
    writeErr: (str) => process.stderr.write(str),
  });

// Global options middleware
program.addHook('preAction', async (thisCommand) => {
  const options = thisCommand.opts();

  // Load config if API key not provided
  if (!options.apiKey) {
    const config = await ConfigService.load();
    if (config.apiKey) {
      options.apiKey = config.apiKey;
    } else {
      console.error('Error: API key not set. Use --api-key or "codepod config set API_KEY <key>"');
      process.exit(1);
    }
  }
});

// Add commands
program.addCommand(configCommand());
program.addCommand(sandboxCommand());
program.addCommand(imageCommand());
program.addCommand(snapshotCommand());
program.addCommand(keyCommand());
program.addCommand(replCommand());

// Shell completion
program.addCommand(completionCommand());

program.parse();
```

### 4.2 Sandbox 命令组

```typescript
// src/commands/sandbox/index.ts

import { Command } from 'commander';
import { createCommand } from './create';
import { listCommand } from './list';
import { getCommand } from './get';
import { deleteCommand } from './delete';
import { sshCommand } from './ssh';
import { stopCommand } from './stop';
import { restartCommand } from './restart';
import { logsCommand } from './logs';
import { metricsCommand } from './metrics';

export function sandboxCommand(): Command {
  const command = new Command('sandbox')
    .description('Manage sandboxes');

  command.addCommand(createCommand());
  command.addCommand(listCommand());
  command.addCommand(getCommand());
  command.addCommand(deleteCommand());
  command.addCommand(sshCommand());
  command.addCommand(stopCommand());
  command.addCommand(restartCommand());
  command.addCommand(logsCommand());
  command.addCommand(metricsCommand());

  return command;
}
```

### 4.3 创建 Sandbox

```typescript
// src/commands/sandbox/create.ts

import { Command } from 'commander';
import inquirer from 'inquirer';
import ora from 'ora';
import { ApiService } from '../../services/api';
import { formatResources } from '../../utils/format';

export function createCommand(): Command {
  const command = new Command('create [name]')
    .description('Create a new sandbox')
    .option('--image <name>', 'Docker image', 'python:3.11')
    .option('--version <tag>', 'Image version', 'latest')
    .option('--cpu <cores>', 'CPU cores', '1')
    .option('--memory <size>', 'Memory size', '512Mi')
    .option('--timeout <seconds>', 'Idle timeout', '3600')
    .option('--env <key=value>', 'Environment variables', (val, prev) => {
      const env = prev || {};
      const [key, value] = val.split('=');
      env[key] = value;
      return env;
    }, {})
    .option('--non-interactive', 'Skip interactive prompts')
    .action(async (name, options) => {
      const spinner = ora('Creating sandbox...').start();

      try {
        // Interactive mode: prompt for additional options
        if (!options.nonInteractive && !options.image) {
          const answers = await inquirer.prompt([
            {
              type: 'list',
              name: 'image',
              message: 'Select base image:',
              choices: [
                { name: 'Python 3.11', value: 'python:3.11' },
                { name: 'Node.js 20', value: 'node:20' },
                { name: 'Go 1.22', value: 'go:1.22' },
                { name: 'Ubuntu 22.04', value: 'ubuntu:22.04' },
              ],
            },
            {
              type: 'input',
              name: 'cpu',
              message: 'CPU cores:',
              default: '1',
              validate: (input) => Number(input) > 0 || 'Must be > 0',
            },
            {
              type: 'input',
              name: 'memory',
              message: 'Memory (e.g., 512Mi, 2Gi):',
              default: '512Mi',
            },
          ]);

          options.image = answers.image;
          options.cpu = answers.cpu;
          options.memory = answers.memory;
        }

        const sandbox = await ApiService.createSandbox({
          name,
          image: options.image,
          version: options.version,
          resources: {
            cpu: Number(options.cpu),
            memory: options.memory,
          },
          timeout: Number(options.timeout),
          env: options.env,
        });

        spinner.succeed(`Sandbox created: ${sandbox.id}`);

        // Display sandbox info
        console.log('\n' + '='.repeat(60));
        console.log('Sandbox Information:');
        console.log(`  ID:       ${sandbox.id}`);
        console.log(`  Name:     ${sandbox.name}`);
        console.log(`  Status:   ${sandbox.status}`);
        console.log(`  Image:    ${sandbox.image}`);
        console.log(`  Resources: ${formatResources(sandbox.resources)}`);
        console.log(`  SSH:      ${sandbox.connection.ssh.user}@${sandbox.connection.ssh.host}`);
        console.log('='.repeat(60) + '\n');

        // Offer to connect
        const { connect } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'connect',
            message: 'Connect to sandbox via SSH?',
            default: true,
          },
        ]);

        if (connect) {
          const { spawn } = await import('child_process');
          const ssh = spawn('codepod', ['sandbox', 'ssh', sandbox.id], {
            stdio: 'inherit',
          });
          await new Promise((resolve) => ssh.on('close', resolve));
        }
      } catch (error) {
        spinner.fail(`Failed to create sandbox: ${error.message}`);
        process.exit(1);
      }
    });

  return command;
}
```

### 4.4 SSH 连接

```typescript
// src/commands/sandbox/ssh.ts

import { Command } from 'commander';
import { Client } from 'ssh2';
import ora from 'ora';
import readline from 'readline';
import { ApiService } from '../../services/api';
import { ConfigService } from '../../services/config';

export function sshCommand(): Command {
  const command = new Command('ssh <id>')
    .description('Connect to sandbox via SSH')
    .option('--command <cmd>', 'Execute command and exit')
    .option('--execute <file>', 'Execute script file and exit')
    .option('--interactive', 'Force interactive mode', true)
    .action(async (id, options) => {
      const spinner = ora('Getting sandbox info...').start();

      try {
        // Get sandbox info
        const sandbox = await ApiService.getSandbox(id);

        if (!sandbox) {
          spinner.fail(`Sandbox not found: ${id}`);
          process.exit(1);
        }

        if (sandbox.status !== 'running') {
          spinner.fail(`Sandbox is not running (status: ${sandbox.status})`);
          process.exit(1);
        }

        spinner.succeed();

        // Load or generate SSH token
        const config = await ConfigService.load();
        let token = sandbox.connection?.ssh?.token;

        if (!token && config.autoToken) {
          token = config.autoToken;
        }

        if (!token) {
          // Request a new connection token
          token = await ApiService.getConnectionToken(id);
          // Save for future use
          await ConfigService.saveConnectionToken(id, token);
        }

        // Connect via SSH
        await connectViaSSH(sandbox, token, options);
      } catch (error) {
        spinner.fail(`SSH connection failed: ${error.message}`);
        process.exit(1);
      }
    });

  return command;
}

async function connectViaSSH(
  sandbox: any,
  token: string,
  options: { command?: string; execute?: string; interactive?: boolean }
): Promise<void> {
  const conn = new Client();

  const sshConfig = {
    host: sandbox.connection.ssh.host,
    port: sandbox.connection.ssh.port || 22,
    username: sandbox.connection.ssh.user,
    password: token,
    readyTimeout: 10000,
    timeout: 30000,
  };

  return new Promise((resolve, reject) => {
    conn.on('ready', () => {
      if (options.command) {
        // Execute single command
        conn.exec(options.command, (err, stream) => {
          if (err) {
            conn.end();
            return reject(err);
          }

          stream.on('close', (code, signal) => {
            conn.end();
            resolve();
          }).on('data', (data) => {
            process.stdout.write(data.toString());
          }).stderr.on('data', (data) => {
            process.stderr.write(data.toString());
          });
        });
      } else if (options.execute) {
        // Execute script file
        const fs = require('fs');
        const script = fs.readFileSync(options.execute, 'utf8');

        conn.exec(`python3 - << 'PYTHON_SCRIPT'\n${script}\nPYTHON_SCRIPT`, (err, stream) => {
          if (err) {
            conn.end();
            return reject(err);
          }

          stream.on('close', () => {
            conn.end();
            resolve();
          }).on('data', (data) => {
            process.stdout.write(data.toString());
          });
        });
      } else {
        // Interactive shell
        console.log(`Connected to ${sandbox.name}. Type 'exit' to disconnect.\n`);

        conn.shell((err, stream) => {
          if (err) {
            conn.end();
            return reject(err);
          }

          // Handle terminal
          process.stdin.setRawMode(true);
          stream.pipe(process.stdout);

          // Handle input
          process.stdin.pipe(stream);

          stream.on('close', () => {
            process.stdin.setRawMode(false);
            conn.end();
            resolve();
          });
        });
      }
    }).on('error', reject).connect(sshConfig);
  });
}
```

### 4.5 API 服务

```typescript
// src/services/api.ts

import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from '../utils/logger';

interface CreateSandboxRequest {
  name?: string;
  image: string;
  version?: string;
  resources?: {
    cpu?: number;
    memory?: string;
    disk?: string;
  };
  timeout?: number;
  env?: Record<string, string>;
  annotations?: Record<string, string>;
}

interface SandboxResponse {
  id: string;
  name: string;
  status: string;
  image: string;
  resources: any;
  connection: {
    ssh: {
      host: string;
      port: number;
      user: string;
      token?: string;
    };
    ports: number[];
  };
  createdAt: string;
  expiresAt?: string;
}

export class ApiService {
  private client: AxiosInstance;
  private baseUrl: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl;
    this.client = axios.create({
      baseURL: `${baseUrl}/api/v1`,
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    // Response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        const message = error.response?.data || error.message;
        logger.error(`API Error: ${error.config?.method?.toUpperCase()} ${error.config?.url}`, message);
        throw new Error(`API Error: ${typeof message === 'object' ? JSON.stringify(message) : message}`);
      }
    );
  }

  /**
   * Create a new sandbox
   */
  static async createSandbox(input: CreateSandboxRequest): Promise<SandboxResponse> {
    const config = await ConfigService.load();
    const api = new ApiService(config.serverUrl, config.apiKey);
    return api.createSandbox(input);
  }

  async createSandbox(input: CreateSandboxRequest): Promise<SandboxResponse> {
    const response = await this.client.post('/sandboxes', input);
    return response.data;
  }

  /**
   * Get sandbox info
   */
  static async getSandbox(id: string): Promise<SandboxResponse | null> {
    const config = await ConfigService.load();
    const api = new ApiService(config.serverUrl, config.apiKey);
    return api.getSandbox(id);
  }

  async getSandbox(id: string): Promise<SandboxResponse | null> {
    try {
      const response = await this.client.get(`/sandboxes/${id}`);
      return response.data;
    } catch (error) {
      if ((error as AxiosError)?.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * List sandboxes
   */
  static async listSandboxes(options: {
    status?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ sandboxes: SandboxResponse[]; total: number }> {
    const config = await ConfigService.load();
    const api = new ApiService(config.serverUrl, config.apiKey);
    return api.listSandboxes(options);
  }

  async listSandboxes(options: {
    status?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ sandboxes: SandboxResponse[]; total: number }> {
    const params = new URLSearchParams();
    if (options.status) params.append('status', options.status);
    if (options.limit) params.append('limit', options.limit.toString());
    if (options.offset) params.append('offset', options.offset.toString());

    const response = await this.client.get(`/sandboxes?${params.toString()}`);
    return response.data;
  }

  /**
   * Delete sandbox
   */
  static async deleteSandbox(id: string, force?: boolean): Promise<void> {
    const config = await ConfigService.load();
    const api = new ApiService(config.serverUrl, config.apiKey);
    return api.deleteSandbox(id, force);
  }

  async deleteSandbox(id: string, force?: boolean): Promise<void> {
    await this.client.delete(`/sandboxes/${id}`, {
      params: { force: force || false },
    });
  }

  /**
   * Get connection token
   */
  static async getConnectionToken(sandboxId: string): Promise<string> {
    const config = await ConfigService.load();
    const api = new ApiService(config.serverUrl, config.apiKey);
    return api.getConnectionToken(sandboxId);
  }

  async getConnectionToken(sandboxId: string): Promise<string> {
    const response = await this.client.post(`/sandboxes/${sandboxId}/token`);
    return response.data.token;
  }

  /**
   * List images
   */
  static async listImages(): Promise<any[]> {
    const config = await ConfigService.load();
    const api = new ApiService(config.serverUrl, config.apiKey);
    return api.listImages();
  }

  async listImages(): Promise<any[]> {
    const response = await this.client.get('/images');
    return response.data.images;
  }

  /**
   * Create snapshot
   */
  static async createSnapshot(
    sandboxId: string,
    name: string,
    description?: string
  ): Promise<any> {
    const config = await ConfigService.load();
    const api = new ApiService(config.serverUrl, config.apiKey);
    return api.createSnapshot(sandboxId, name, description);
  }

  async createSnapshot(
    sandboxId: string,
    name: string,
    description?: string
  ): Promise<any> {
    const response = await this.client.post(`/sandboxes/${sandboxId}/snapshots`, {
      name,
      description,
    });
    return response.data;
  }

  /**
   * Restore snapshot
   */
  static async restoreSnapshot(sandboxId: string, snapshotId: string): Promise<void> {
    const config = await ConfigService.load();
    const api = new ApiService(config.serverUrl, config.apiKey);
    return api.restoreSnapshot(sandboxId, snapshotId);
  }

  async restoreSnapshot(sandboxId: string, snapshotId: string): Promise<void> {
    await this.client.post(`/sandboxes/${sandboxId}/snapshots/${snapshotId}/restore`);
  }

  /**
   * Get sandbox metrics
   */
  static async getMetrics(
    sandboxId: string,
    options: { startTime?: string; endTime?: string; interval?: string } = {}
  ): Promise<any> {
    const config = await ConfigService.load();
    const api = new ApiService(config.serverUrl, config.apiKey);
    return api.getMetrics(sandboxId, options);
  }

  async getMetrics(
    sandboxId: string,
    options: { startTime?: string; endTime?: string; interval?: string } = {}
  ): Promise<any> {
    const params = new URLSearchParams();
    if (options.startTime) params.append('startTime', options.startTime);
    if (options.endTime) params.append('endTime', options.endTime);
    if (options.interval) params.append('interval', options.interval);

    const response = await this.client.get(`/sandboxes/${sandboxId}/metrics?${params.toString()}`);
    return response.data;
  }
}
```

### 4.6 配置服务

```typescript
// src/services/config.ts

import fs from 'fs';
import path from 'path';
import os from 'os';

interface Config {
  serverUrl: string;
  apiKey?: string;
  defaultTimeout: number;
  defaultRegion?: string;
  connectionTokens: Record<string, string>;
  autoToken?: string;
  outputFormat: 'table' | 'json' | 'yaml';
}

const CONFIG_FILE = path.join(os.homedir(), '.codepod', 'config.json');

export class ConfigService {
  private static config: Config | null = null;

  /**
   * Load config from file
   */
  static async load(): Promise<Config> {
    if (this.config) {
      return this.config;
    }

    try {
      const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
      this.config = JSON.parse(content);
    } catch (error) {
      this.config = {
        serverUrl: 'http://localhost:3000',
        defaultTimeout: 3600,
        connectionTokens: {},
        outputFormat: 'table',
      };
    }

    return this.config;
  }

  /**
   * Save config to file
   */
  static async save(config: Config): Promise<void> {
    const dir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    this.config = config;
  }

  /**
   * Set API Key
   */
  static async setApiKey(key: string): Promise<void> {
    const config = await this.load();
    config.apiKey = key;
    await this.save(config);
    console.log('API Key saved successfully');
  }

  /**
   * Set server URL
   */
  static async setServerUrl(url: string): Promise<void> {
    const config = await this.load();
    config.serverUrl = url;
    await this.save(config);
    console.log(`Server URL set to: ${url}`);
  }

  /**
   * Set default option
   */
  static async setDefault(key: string, value: string): Promise<void> {
    const config = await this.load();

    switch (key) {
      case 'timeout':
        config.defaultTimeout = parseInt(value, 10);
        break;
      case 'region':
        config.defaultRegion = value;
        break;
      case 'format':
        if (!['table', 'json', 'yaml'].includes(value)) {
          throw new Error('Invalid format. Use: table, json, or yaml');
        }
        config.outputFormat = value as Config['outputFormat'];
        break;
      default:
        throw new Error(`Unknown option: ${key}`);
    }

    await this.save(config);
    console.log(`Default ${key} set to: ${value}`);
  }

  /**
   * Show current config
   */
  static async show(): Promise<void> {
    const config = await this.load();

    console.log('\nCodePod CLI Configuration:');
    console.log(`  Server URL:     ${config.serverUrl}`);
    console.log(`  API Key:       ${config.apiKey ? '********' : 'Not set'}`);
    console.log(`  Default Timeout: ${config.defaultTimeout}s`);
    console.log(`  Default Region: ${config.defaultRegion || 'Not set'}`);
    console.log(`  Output Format: ${config.outputFormat}`);
    console.log(`  Tokens:        ${Object.keys(config.connectionTokens).length} saved\n`);
  }

  /**
   * Save connection token for sandbox
   */
  static async saveConnectionToken(sandboxId: string, token: string): Promise<void> {
    const config = await this.load();
    config.connectionTokens[sandboxId] = token;
    await this.save(config);
  }

  /**
   * Get connection token for sandbox
   */
  static async getConnectionToken(sandboxId: string): Promise<string | undefined> {
    const config = await this.load();
    return config.connectionTokens[sandboxId];
  }

  /**
   * Clear all saved tokens
   */
  static async clearTokens(): Promise<void> {
    const config = await this.load();
    config.connectionTokens = {};
    await this.save(config);
    console.log('All saved connection tokens cleared');
  }
}
```

---

## 5. 格式化工具

```typescript
// src/utils/format.ts

/**
 * Format resources for display
 */
export function formatResources(resources: {
  cpu: number;
  memory: string;
  disk?: string;
}): string {
  const parts = [`CPU: ${resources.cpu} core(s)`];

  if (resources.memory) {
    parts.push(`Memory: ${formatMemory(resources.memory)}`);
  }

  if (resources.disk) {
    parts.push(`Disk: ${formatMemory(resources.disk)}`);
  }

  return parts.join(', ');
}

/**
 * Format memory string
 */
export function formatMemory(bytes: string | number): string {
  if (typeof bytes === 'string') {
    return bytes;
  }

  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let unitIndex = 0;
  let size = bytes;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * Format time duration
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours < 24) {
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;

  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

/**
 * Format timestamp
 */
export function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString();
}

/**
 * Format status with color
 */
export function formatStatus(status: string): string {
  const colors: Record<string, string> = {
    running: 'green',
    pending: 'yellow',
    failed: 'red',
    stopped: 'gray',
    archived: 'gray',
  };

  const chalk = require('chalk');
  const colorFn = colors[status] ? (chalk as any)[colors[status]] : chalk.white;

  return colorFn(status);
}

/**
 * Format table
 */
export function formatTable<T extends Record<string, any>>(
  data: T[],
  columns: { key: keyof T; header: string; width?: number }[]
): string {
  // Calculate column widths
  const widths = columns.map((col) => {
    const maxLen = Math.max(
      col.header.length,
      ...data.map((row) => String(row[col.key] || '').length)
    );
    return col.width || Math.min(maxLen + 2, 50);
  });

  // Format header
  const header = columns
    .map((col, i) => col.header.padEnd(widths[i]))
    .join('  ');

  // Format separator
  const separator = widths.map((w) => '-'.repeat(w)).join('  ');

  // Format rows
  const rows = data.map((row) =>
    columns
      .map((col, i) => String(row[col.key] || '').padEnd(widths[i]))
      .join('  ')
  );

  return [header, separator, ...rows].join('\n');
}
```

---

## 6. 目录结构总结

```
apps/cli/
├── src/
│   ├── index.ts                    # CLI 入口，Commander.js 配置
│   ├── config.ts                   # 配置服务
│   │
│   ├── commands/
│   │   ├── sandbox/               # Sandbox 命令组
│   │   │   ├── index.ts           # 命令组入口
│   │   │   ├── create.ts          # 创建 Sandbox
│   │   │   ├── list.ts            # 列出 Sandbox
│   │   │   ├── get.ts             # 获取 Sandbox 信息
│   │   │   ├── delete.ts          # 删除 Sandbox
│   │   │   ├── ssh.ts             # SSH 连接
│   │   │   ├── stop.ts            # 停止 Sandbox
│   │   │   ├── restart.ts         # 重启 Sandbox
│   │   │   ├── logs.ts            # 查看日志
│   │   │   └── metrics.ts         # 查看指标
│   │   │
│   │   ├── image/                 # 镜像命令
│   │   │   └── list.ts
│   │   │
│   │   ├── snapshot/              # 快照命令
│   │   │   ├── index.ts
│   │   │   ├── create.ts
│   │   │   ├── list.ts
│   │   │   ├── restore.ts
│   │   │   └── delete.ts
│   │   │
│   │   ├── key/                   # API Key 命令
│   │   │   ├── index.ts
│   │   │   ├── list.ts
│   │   │   └── create.ts
│   │   │
│   │   ├── config.ts              # 配置命令
│   │   ├── completion.ts          # Shell 补全
│   │   └── repl.ts                # REPL 模式
│   │
│   ├── services/
│   │   ├── api.ts                 # API 客户端封装
│   │   └── config.ts              # 配置管理
│   │
│   ├── utils/
│   │   ├── logger.ts              # 日志输出
│   │   ├── format.ts             # 格式化工具
│   │   └── spinner.ts             # 加载动画
│   │
│   └── repl/                      # REPL 交互模式
│       ├── index.ts
│       └── client.ts
│
├── bin/
│   └── codepod                   # 可执行脚本
│
├── package.json                   # 依赖配置
├── tsconfig.json
└── README.md
```

---

## 7. 依赖配置

```json
{
  "name": "@codepod/cli",
  "version": "0.1.0",
  "description": "CodePod CLI - Sandbox management client",
  "main": "dist/index.js",
  "bin": {
    "codepod": "./bin/codepod"
  },
  "scripts": {
    "build": "tsc",
    "dev": "ts-node src/index.ts",
    "start": "node dist/index.js",
    "link": "npm link"
  },
  "dependencies": {
    "commander": "^11.1.0",
    "inquirer": "^9.2.12",
    "axios": "^1.6.7",
    "ssh2": "^1.15.0",
    "node-pty": "^1.0.0",
    "chalk": "^5.3.0",
    "ora": "^8.0.1",
    "yaml": "^2.3.4",
    "readline": "^1.3.0"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "@types/inquirer": "^9.0.7",
    "@types/ssh2": "^1.11.18",
    "typescript": "^5.3.0",
    "ts-node": "^10.9.2"
  }
}
```

---

## 8. 使用示例

### 8.1 初始化配置

```bash
# 设置 Server URL
codepod config set server https://api.codepod.io

# 设置 API Key
codepod config set API_KEY cp_xxxxxxxxxxxx

# 查看配置
codepod config show
```

### 8.2 创建并连接 Sandbox

```bash
# 交互式创建
codepod sandbox create

# 指定参数创建
codepod sandbox create my-dev --image python:3.11 --cpu 2 --memory 4Gi

# 连接到 Sandbox
codepod sandbox ssh my-dev

# 执行命令后退出
codepod sandbox ssh my-dev --command "python -c 'print(1+2)'"

# 执行脚本
codepod sandbox ssh my-dev --execute script.py
```

### 8.3 管理多个 Sandbox

```bash
# 列出所有 Sandbox
codepod sandbox list

# 过滤运行中的
codepod sandbox list --status running

# 查看详情
codepod sandbox get my-dev

# 查看指标
codepod sandbox metrics my-dev

# 停止
codepod sandbox stop my-dev

# 删除
codepod sandbox delete my-dev --force
```

### 8.4 快照管理

```bash
# 创建快照
codepod snapshot create my-dev backup-v1 --description "Before major changes"

# 列出快照
codepod snapshot list my-dev

# 恢复快照
codepod snapshot restore my-dev snap-xxx

# 删除快照
codepod snapshot delete my-dev snap-xxx
```

---

## 9. 补充功能实现

### 9.1 安全配置存储

```typescript
// src/services/config.ts (增强版)

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

interface Config {
  serverUrl: string;
  apiKey?: string;  // 加密存储
  defaultTimeout: number;
  defaultRegion?: string;
  connectionTokens: Record<string, string>;  // 加密存储
  autoToken?: string;
  outputFormat: 'table' | 'json' | 'yaml';
  configKey?: string;  // 用于加密的密钥
}

const CONFIG_FILE = path.join(os.homedir(), '.codepod', 'config.json');
const CONFIG_DIR = path.dirname(CONFIG_FILE);

// 加密/解密工具
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const KEY_LENGTH = 32;
const TAG_LENGTH = 16;

function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, 100000, KEY_LENGTH, 'sha512');
}

export function encrypt(text: string, password: string): string {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(password, salt);

  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // 格式: salt(64) + iv(16) + tag(16) + encrypted
  return Buffer.concat([salt, iv, tag, encrypted]).toString('base64');
}

export function decrypt(encryptedText: string, password: string): string {
  const data = Buffer.from(encryptedText, 'base64');
  const salt = data.subarray(0, SALT_LENGTH);
  const iv = data.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const tag = data.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const encrypted = data.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

  const key = deriveKey(password, salt);
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return decipher.update(encrypted) + decipher.final('utf8');
}

export class ConfigService {
  private static config: Config | null = null;
  private static masterPassword: string | null = null;

  /**
   * 获取或设置主密码
   */
  private static getMasterPassword(): string {
    if (!this.masterPassword) {
      // 从环境变量获取
      this.masterPassword = process.env.CODEPOD_PASSWORD || '';

      if (!this.masterPassword) {
        // 交互式输入
        console.log('Enter master password for config encryption:');
        this.masterPassword = require('readline').createInterface({
          input: process.stdin,
          output: process.stdout,
        }).question('Password: ', (answer: string) => {
          this.masterPassword = answer;
        });
      }
    }
    return this.masterPassword;
  }

  /**
   * 加密敏感数据
   */
  static encryptSensitive(data: string): string {
    return encrypt(data, this.getMasterPassword());
  }

  /**
   * 解密敏感数据
   */
  static decryptSensitive(encrypted: string): string {
    return decrypt(encrypted, this.getMasterPassword());
  }

  /**
   * 加载配置
   */
  static async load(): Promise<Config> {
    if (this.config) {
      return this.config;
    }

    try {
      if (!fs.existsSync(CONFIG_FILE)) {
        this.config = this.getDefaultConfig();
        await this.save(this.config);
        return this.config;
      }

      const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
      this.config = JSON.parse(content);
    } catch (error) {
      this.config = this.getDefaultConfig();
    }

    return this.config;
  }

  private static getDefaultConfig(): Config {
    return {
      serverUrl: 'http://localhost:3000',
      defaultTimeout: 3600,
      connectionTokens: {},
      outputFormat: 'table',
    };
  }

  /**
   * 保存配置（自动加密敏感数据）
   */
  static async save(config: Config): Promise<void> {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }

    // 加密 API Key
    if (config.apiKey) {
      config.apiKey = this.encryptSensitive(config.apiKey);
    }

    // 加密连接 Token
    if (Object.keys(config.connectionTokens).length > 0) {
      const encryptedTokens: Record<string, string> = {};
      for (const [key, value] of Object.entries(config.connectionTokens)) {
        encryptedTokens[key] = this.encryptSensitive(value);
      }
      config.connectionTokens = encryptedTokens;
    }

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    this.config = config;
  }
}
```

### 9.2 等待 Sandbox 就绪

```typescript
// src/commands/sandbox/wait.ts

import { Command } from 'commander';
import ora from 'ora';
import { ApiService } from '../../services/api';

export function waitCommand(): Command {
  const command = new Command('wait <id>')
    .description('Wait for sandbox to be ready')
    .option('--timeout <seconds>', 'Max wait time', '300')
    .option('--interval <ms>', 'Check interval', '2000')
    .action(async (id, options) => {
      const spinner = ora('Waiting for sandbox to be ready...').start();
      const startTime = Date.now();
      const timeoutMs = parseInt(options.timeout) * 1000;
      const intervalMs = parseInt(options.interval);

      while (Date.now() - startTime < timeoutMs) {
        try {
          const sandbox = await ApiService.getSandbox(id);

          if (!sandbox) {
            spinner.fail(`Sandbox not found: ${id}`);
            process.exit(1);
          }

          switch (sandbox.status) {
            case 'running':
              spinner.succeed(`Sandbox is ready!`);
              console.log(`  ID:     ${sandbox.id}`);
              console.log(`  Name:   ${sandbox.name}`);
              console.log(`  SSH:    ${sandbox.connection.ssh.user}@${sandbox.connection.ssh.host}`);
              return;

            case 'failed':
              spinner.fail(`Sandbox failed to start`);
              process.exit(1);

            case 'pending':
              const elapsed = Math.floor((Date.now() - startTime) / 1000);
              spinner.text = `Waiting... (${elapsed}s elapsed, status: ${sandbox.status})`;
              break;

            default:
              const elapsed = Math.floor((Date.now() - startTime) / 1000);
              spinner.text = `Waiting... (${elapsed}s elapsed, status: ${sandbox.status})`;
          }

          await new Promise(resolve => setTimeout(resolve, intervalMs));
        } catch (error) {
          // 忽略临时错误
        }
      }

      spinner.fail('Timeout waiting for sandbox');
      process.exit(1);
    });

  return command;
}
```

### 9.3 端口转发

```typescript
// src/commands/sandbox/port.ts

import { Command } from 'commander';
import { Client } from 'ssh2';
import { ApiService } from '../../services/api';
import { ConfigService } from '../../services/config';

export function portCommand(): Command {
  const command = new Command('port <id>')
    .description('Forward local port to sandbox')
    .option('--local-port <port>', 'Local port to forward', '8080')
    .option('--remote-port <port>', 'Remote port in sandbox', '80')
    .option('--host <host>', 'Remote host in sandbox', 'localhost')
    .action(async (id, options) => {
      const sandbox = await ApiService.getSandbox(id);

      if (!sandbox || sandbox.status !== 'running') {
        console.error('Sandbox not found or not running');
        process.exit(1);
      }

      const config = await ConfigService.load();
      const token = config.connectionTokens[id];

      if (!token) {
        console.error('No saved token for this sandbox. Use "codepod sandbox ssh" first.');
        process.exit(1);
      }

      console.log(`Forwarding localhost:${options.localPort} -> ${options.host}:${options.remotePort}`);
      console.log('Press Ctrl+C to stop\n');

      const conn = new Client();

      conn.on('ready', () => {
        conn.forwardOut(
          '127.0.0.1',
          parseInt(options.localPort),
          options.host,
          parseInt(options.remotePort),
          (err, stream) => {
            if (err) {
              console.error('Forward error:', err);
              conn.end();
              process.exit(1);
            }

            stream.on('close', () => {
              conn.end();
              process.exit(0);
            });

            // 简单 echo
            stream.pipe(process.stdout);
            process.stdin.pipe(stream);
            process.stdin.resume();
          }
        );
      }).connect({
        host: sandbox.connection.ssh.host,
        port: sandbox.connection.ssh.port,
        username: sandbox.connection.ssh.user,
        password: token,
      });

      // 处理 Ctrl+C
      process.on('SIGINT', () => {
        conn.end();
        process.exit(0);
      });
    });

  return command;
}
```

### 9.4 查看日志

```typescript
// src/commands/sandbox/logs.ts

import { Command } from 'commander';
import { ApiService } from '../../services/api';
import { formatTimestamp } from '../../utils/format';

export function logsCommand(): Command {
  const command = new Command('logs <id>')
    .description('View sandbox logs')
    .option('--lines <n>', 'Number of lines', '100')
    .option('--follow', 'Follow logs in real-time')
    .option('--stream <type>', 'Log stream type', 'all', 'stdout', 'stderr', 'all')
    .action(async (id, options) => {
      if (options.follow) {
        await followLogs(id, options);
      } else {
        await showLogs(id, options);
      }
    });

  return command;
}

async function showLogs(id: string, options: any): Promise<void> {
  const logs = await ApiService.getSandboxLogs(id, {
    lines: parseInt(options.lines),
    stream: options.stream,
  });

  if (!logs || logs.length === 0) {
    console.log('No logs available');
    return;
  }

  for (const log of logs) {
    const timestamp = formatTimestamp(log.timestamp);
    const stream = log.stream === 'stderr' ? 'ERR' : 'OUT';
    console.log(`[${timestamp}] [${stream}] ${log.data}`);
  }
}

async function followLogs(id: string, options: any): Promise<void> {
  console.log('Following logs... (Ctrl+C to stop)\n');

  const eventSource = await ApiService.streamSandboxLogs(id, options.stream);

  eventSource.on('log', (log: any) => {
    const timestamp = formatTimestamp(log.timestamp);
    const stream = log.stream === 'stderr' ? 'ERR' : 'OUT';
    process.stdout.write(`[${timestamp}] [${stream}] ${log.data}`);
  });

  eventSource.on('error', (error: any) => {
    console.error('\nStream error:', error.message);
    process.exit(1);
  });

  eventSource.on('close', () => {
    console.log('\nLog stream closed');
    process.exit(0);
  });

  // 处理 Ctrl+C
  process.on('SIGINT', () => {
    eventSource.close();
    process.exit(0);
  });
}
```

### 9.5 查看指标

```typescript
// src/commands/sandbox/metrics.ts

import { Command } from 'commander';
import { ApiService } from '../../services/api';
import { formatTimestamp, formatMemory } from '../../utils/format';

export function metricsCommand(): Command {
  const command = new Command('metrics <id>')
    .description('View sandbox metrics')
    .option('--start-time <ISO>', 'Start time')
    .option('--end-time <ISO>', 'End time')
    .option('--interval <interval>', 'Aggregation interval', '1m')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      const metrics = await ApiService.getMetrics(id, {
        startTime: options.startTime,
        endTime: options.endTime,
        interval: options.interval,
      });

      if (options.json) {
        console.log(JSON.stringify(metrics, null, 2));
        return;
      }

      console.log(`\nSandbox Metrics: ${id}`);
      console.log(`Interval: ${metrics.interval}\n`);

      // 显示汇总
      console.log('Summary:');
      console.log(`  Avg CPU:      ${metrics.summary.avgCpuUsage?.toFixed(2) || 0}%`);
      console.log(`  Max CPU:      ${metrics.summary.maxCpuUsage?.toFixed(2) || 0}%`);
      console.log(`  Avg Memory:   ${metrics.summary.avgMemoryUsage?.toFixed(2) || 0}%`);
      console.log(`  Max Memory:   ${metrics.summary.maxMemoryUsage?.toFixed(2) || 0}%`);

      // 显示数据点
      if (metrics.dataPoints && metrics.dataPoints.length > 0) {
        console.log('\nRecent Data Points:');
        console.log('  Timestamp              CPU%    Memory%');
        console.log('  ' + '-'.repeat(45));

        for (const point of metrics.dataPoints.slice(-10)) {
          const time = formatTimestamp(point.timestamp);
          const cpu = (point.cpuUsage || 0).toFixed(1).padStart(5);
          const mem = (point.memoryUsage || 0).toFixed(1).padStart(5);
          console.log(`  ${time}  ${cpu}    ${mem}`);
        }
      }

      console.log('');
    });

  return command;
}
```

### 9.6 API Key 撤销

```typescript
// src/commands/key/revoke.ts

import { Command } from 'commander';
import inquirer from 'inquirer';
import ora from 'ora';
import { ApiService } from '../../services/api';

export function revokeCommand(): Command {
  const command = new Command('revoke <key_id>')
    .description('Revoke an API key')
    .option('--force', 'Skip confirmation')
    .action(async (id, options) => {
      const spinner = ora('Revoking API key...').start();

      try {
        // 获取 Key 信息
        const keys = await ApiService.listApiKeys();
        const key = keys.find((k: any) => k.id === id);

        if (!key) {
          spinner.fail(`API key not found: ${id}`);
          process.exit(1);
        }

        // 确认
        if (!options.force) {
          const { confirm } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'confirm',
              message: `Revoke API key "${key.name}"? This action cannot be undone.`,
              default: false,
            },
          ]);

          if (!confirm) {
            console.log('Cancelled');
            return;
          }
        }

        await ApiService.revokeApiKey(id);
        spinner.succeed(`API key "${key.name}" revoked successfully`);
      } catch (error) {
        spinner.fail(`Failed to revoke API key: ${error.message}`);
        process.exit(1);
      }
    });

  return command;
}
```

### 9.7 删除确认

```typescript
// src/commands/sandbox/delete.ts (增强版)

import { Command } from 'commander';
import inquirer from 'inquirer';
import ora from 'ora';
import { ApiService } from '../../services/api';

export function deleteCommand(): Command {
  const command = new Command('delete <id>')
    .description('Delete a sandbox')
    .option('--force', 'Skip confirmation')
    .option('--grace-period <seconds>', 'Grace period before deletion', '0')
    .action(async (id, options) => {
      const spinner = ora('Getting sandbox info...').start();

      try {
        const sandbox = await ApiService.getSandbox(id);

        if (!sandbox) {
          spinner.fail(`Sandbox not found: ${id}`);
          process.exit(1);
        }

        spinner.stop();

        // 确认
        if (!options.force) {
          const statusColor = sandbox.status === 'running' ? 'red' : 'gray';
          console.log(`\nSandbox to delete:`);
          console.log(`  ID:      ${sandbox.id}`);
          console.log(`  Name:    ${sandbox.name}`);
          console.log(`  Status:  ${sandbox.status}`);
          console.log(`  Image:   ${sandbox.image}`);

          const { confirm } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'confirm',
              message: `Delete sandbox "${sandbox.name}"?`,
              default: false,
            },
          ]);

          if (!confirm) {
            console.log('Cancelled');
            return;
          }
        }

        spinner.start('Deleting sandbox...');

        if (parseInt(options.gracePeriod) > 0) {
          await ApiService.deleteSandbox(id, parseInt(options.gracePeriod));
          spinner.succeed(`Sandbox scheduled for deletion in ${options.gracePeriod}s`);
        } else {
          await ApiService.deleteSandbox(id, true);
          spinner.succeed('Sandbox deleted successfully');
        }
      } catch (error) {
        spinner.fail(`Failed to delete sandbox: ${error.message}`);
        process.exit(1);
      }
    });

  return command;
}
```

### 9.8 命令别名

```typescript
// src/commands/sandbox/index.ts (增强版)

import { Command } from 'commander';
import { createCommand } from './create';
import { listCommand } from './list';
import { getCommand } from './get';
import { deleteCommand } from './delete';
import { sshCommand } from './ssh';
import { stopCommand } from './stop';
import { restartCommand } from './restart';
import { logsCommand } from './logs';
import { metricsCommand } from './metrics';
import { waitCommand } from './wait';
import { portCommand } from './port';

export function sandboxCommand(): Command {
  const command = new Command('sandbox')
    .alias('sb')  // 别名
    .description('Manage sandboxes');

  command.addCommand(createCommand());
  command.addCommand(listCommand().alias('ls'));
  command.addCommand(getCommand().alias('info'));
  command.addCommand(deleteCommand().alias('rm', 'del'));
  command.addCommand(sshCommand().alias('connect'));
  command.addCommand(stopCommand());
  command.addCommand(restartCommand());
  command.addCommand(logsCommand().alias('log'));
  command.addCommand(metricsCommand().alias('stats'));
  command.addCommand(waitCommand().alias('ready'));
  command.addCommand(portCommand().alias('forward'));

  return command;
}
```

### 9.9 Shell 自动补全

```typescript
// src/commands/completion.ts

import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import os from 'os';

export function completionCommand(): Command {
  const command = new Command('completion')
    .description('Generate shell completion script')
    .option('--shell <shell>', 'Shell type', 'bash')
    .action(async (options) => {
      const shell = options.shell;
      const cliPath = require.main?.filename || '';

      switch (shell) {
        case 'bash':
          generateBashCompletion();
          break;
        case 'zsh':
          generateZshCompletion();
          break;
        case 'fish':
          generateFishCompletion();
          break;
        default:
          console.error(`Unsupported shell: ${shell}`);
          process.exit(1);
      }
    });

  return command;
}

function generateBashCompletion(): void {
  const completionScript = `#!/usr/bin/env bash
# CodePod CLI Bash Completion

_codepod_completions() {
  COMPREPLY=()
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local prev="\${COMP_WORDS[COMP_CWORD-1]}"

  # Global options
  if [[ $COMP_CWORD -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "sandbox image snapshot key config completion repl -v --help" -- $cur) )
    return 0
  fi

  # Sandbox subcommands
  if [[ $prev == "sandbox" || $prev == "sb" ]]; then
    COMPREPLY=( $(compgen -W "create list get delete ssh stop restart logs metrics wait port -a --" -- $cur) )
    return 0
  fi

  # Image subcommands
  if [[ $prev == "image" ]]; then
    COMPREPLY=( $(compgen -W "list tags" -- $cur) )
    return 0
  fi

  # Snapshot subcommands
  if [[ $prev == "snapshot" ]]; then
    COMPREPLY=( $(compgen -W "create list restore delete" -- $cur) )
    return 0
  fi

  # Key subcommands
  if [[ $prev == "key" ]]; then
    COMPREPLY=( $(compgen -W "list create revoke" -- $cur) )
    return 0
  fi

  # Config subcommands
  if [[ $prev == "config" ]]; then
    COMPREPLY=( $(compgen -W "set show get list" -- $cur) )
    return 0
  fi

  # Common option completions
  if [[ $cur == -* ]]; then
    COMPREPLY=( $(compgen -W "--help --version --server --api-key --non-interactive --force" -- $cur) )
    return 0
  fi
}

complete -F _codepod_completions codepod
`;

  console.log(completionScript);
  console.log('\n# To install, run:');
  console.log('codepod completion bash >> ~/.bashrc');
  console.log('source ~/.bashrc');
}

function generateZshCompletion(): void {
  const completionScript = `#compdef codepod

autoload -U compinit
compinit

_codepod() {
  local -a commands
  commands=(
    'sandbox:Manage sandboxes'
    'image:Manage images'
    'snapshot:Manage snapshots'
    'key:Manage API keys'
    'config:Configure CLI'
    'completion:Generate shell completion'
    'repl:Interactive REPL mode'
  )

  _describe -t commands 'codepod command' commands

  return
}

compdef _codepod codepod
`;

  console.log(completionScript);
  console.log('\n# To install, run:');
  console.log('codepod completion zsh > ~/.zsh/completion/_codepod');
  console.log('autoload -U compinit && compinit');
}

function generateFishCompletion(): void {
  const completionScript = `complete -c codepod -e
complete -c codepod -f -a "(codepod completion fish)"

complete -c codepod -a sandbox -d 'Manage sandboxes'
complete -c codepod -a image -d 'Manage images'
complete -c codepod -a snapshot -d 'Manage snapshots'
complete -c codepod -a key -d 'Manage API keys'
complete -c codepod -a config -d 'Configure CLI'
`;

  console.log(completionScript);
  console.log('\n# To install, run:');
  console.log('codepod completion fish > ~/.config/fish/completions/codepod.fish');
}
```

### 9.10 环境变量文件支持

```typescript
// src/utils/env-file.ts

import fs from 'fs';
import path from 'path';

export interface EnvFileOptions {
  file?: string;      // .env 文件路径
  override?: boolean; // 是否覆盖已存在的环境变量
}

/**
 * 加载 .env 文件
 */
export function loadEnvFile(options: EnvFileOptions = {}): Record<string, string> {
  const envFile = options.file || '.env';
  const filePath = path.resolve(envFile);

  if (!fs.existsSync(filePath)) {
    return {};
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const env: Record<string, string> = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();

    // 跳过注释和空行
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue;
    }

    const [key, ...valueParts] = trimmed.split('=');
    const value = valueParts.join('=').trim();

    // 移除引号
    const cleanValue = value.replace(/^["']|["']$/g, '');

    if (options.override || !process.env[key]) {
      env[key] = cleanValue;
    }
  }

  return env;
}

/**
 * 验证环境变量
 */
export function validateEnv(env: Record<string, string>, required: string[]): void {
  const missing: string[] = [];

  for (const key of required) {
    if (!env[key]) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

/**
 * 合并环境变量
 */
export function mergeEnv(base: Record<string, string>, override: Record<string, string>): Record<string, string> {
  return { ...base, ...override };
}
```

### 9.11 网络重试与健康检查

```typescript
// src/utils/retry.ts

import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';

interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  retryOnStatus: number[];
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
  retryOnStatus: [429, 500, 502, 503, 504],
};

export function createRetryClient(config: Partial<RetryConfig> = {}): AxiosInstance {
  const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };

  const client = axios.create({
    timeout: 30000,
  });

  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const config = error.config as AxiosRequestConfig & { _retryCount?: number };
      const retryCount = config._retryCount || 0;

      // 检查是否应该重试
      if (
        retryCount < retryConfig.maxRetries &&
        error.response &&
        retryConfig.retryOnStatus.includes(error.response.status)
      ) {
        config._retryCount = retryCount + 1;

        // 计算延迟（指数退避）
        const delay = Math.min(
          retryConfig.initialDelay * Math.pow(retryConfig.backoffMultiplier, retryCount),
          retryConfig.maxDelay
        );

        console.log(`Retrying in ${delay}ms (attempt ${retryCount + 1}/${retryConfig.maxRetries})...`);

        await new Promise(resolve => setTimeout(resolve, delay));

        return client(config);
      }

      throw error;
    }
  );

  return client;
}

/**
 * 健康检查
 */
export async function healthCheck(serverUrl: string, timeout: number = 5000): Promise<boolean> {
  try {
    const response = await axios.get(`${serverUrl}/health`, {
      timeout,
      validateStatus: () => true,
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

/**
 * 等待服务就绪
 */
export async function waitForServer(
  serverUrl: string,
  maxAttempts: number = 30,
  interval: number = 2000
): Promise<boolean> {
  console.log(`Waiting for server at ${serverUrl}...`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (await healthCheck(serverUrl)) {
      console.log('Server is ready!');
      return true;
    }

    console.log(`Attempt ${attempt}/${maxAttempts} failed. Retrying in ${interval}ms...`);
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  throw new Error(`Server ${serverUrl} did not become ready in time`);
}
```

### 9.12 创建 Sandbox 进度显示

```typescript
// src/commands/sandbox/create.ts (增强版)

import { Command } from 'commander';
import inquirer from 'inquirer';
import ora from 'ora';
import { ApiService } from '../../services/api';
import { formatResources } from '../../utils/format';
import { waitCommand } from './wait';

export function createCommand(): Command {
  const command = new Command('create [name]')
    .description('Create a new sandbox')
    .option('--image <name>', 'Docker image')
    .option('--version <tag>', 'Image version')
    .option('--cpu <cores>', 'CPU cores')
    .option('--memory <size>', 'Memory size')
    .option('--timeout <seconds>', 'Idle timeout')
    .option('--env <key=value>', 'Environment variables')
    .option('--env-file <path>', 'Load env from file')
    .option('--non-interactive', 'Skip interactive prompts')
    .option('--wait', 'Wait for sandbox to be ready')
    .option('--timeout <seconds>', 'Wait timeout')
    .action(async (name, options) => {
      const spinner = ora('Creating sandbox...').start();

      try {
        // 加载环境变量文件
        let env: Record<string, string> = {};
        if (options.envFile) {
          const { loadEnvFile } = await import('../../utils/env-file');
          env = loadEnvFile({ file: options.envFile });
        }

        // 解析 --env 参数
        if (options.env) {
          for (const pair of [].concat(options.env)) {
            const [key, value] = pair.split('=');
            env[key] = value;
          }
        }

        // 创建 Sandbox
        const sandbox = await ApiService.createSandbox({
          name,
          image: options.image || 'python:3.11',
          version: options.version,
          resources: {
            cpu: Number(options.cpu) || 1,
            memory: options.memory || '512Mi',
          },
          timeout: Number(options.timeout) || 3600,
          env,
        });

        spinner.succeed(`Sandbox created: ${sandbox.id}`);

        // 显示 Sandbox 信息
        console.log('\n' + '='.repeat(60));
        console.log('Sandbox Information:');
        console.log(`  ID:       ${sandbox.id}`);
        console.log(`  Name:     ${sandbox.name}`);
        console.log(`  Status:   ${sandbox.status}`);
        console.log(`  Image:    ${sandbox.image}`);
        console.log(`  Resources: ${formatResources(sandbox.resources)}`);
        console.log(`  SSH:      ${sandbox.connection.ssh.user}@${sandbox.connection.ssh.host}`);
        console.log('='.repeat(60) + '\n');

        // 等待就绪
        if (options.wait) {
          console.log('');
          const waitSpinner = ora('Waiting for sandbox to be ready...').start();

          const startTime = Date.now();
          const timeoutMs = (Number(options.timeout) || 300) * 1000;

          while (Date.now() - startTime < timeoutMs) {
            const updated = await ApiService.getSandbox(sandbox.id);

            if (updated?.status === 'running') {
              waitSpinner.succeed('Sandbox is ready!');
              break;
            } else if (updated?.status === 'failed') {
              waitSpinner.fail('Sandbox failed to start');
              process.exit(1);
            }

            await new Promise(resolve => setTimeout(resolve, 2000));
          }

          if (Date.now() - startTime >= timeoutMs) {
            waitSpinner.warn('Timeout waiting for sandbox');
          }
        }

        // 询问是否连接
        const { connect } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'connect',
            message: 'Connect to sandbox via SSH?',
            default: true,
          },
        ]);

        if (connect) {
          const { spawn } = await import('child_process');
          const ssh = spawn('codepod', ['sandbox', 'ssh', sandbox.id], {
            stdio: 'inherit',
          });
          await new Promise((resolve) => ssh.on('close', resolve));
        }
      } catch (error) {
        spinner.fail(`Failed to create sandbox: ${error.message}`);
        process.exit(1);
      }
    });

  return command;
}
```

---

## 10. 增强功能汇总

### 10.1 新增命令

| 命令 | 别名 | 描述 |
|------|------|------|
| `codepod sandbox wait` | `ready` | 等待 Sandbox 就绪 |
| `codepod sandbox port` | `forward` | 端口转发 |
| `codepod key revoke` | - | 撤销 API Key |

### 10.2 新增功能

| 功能 | 描述 |
|------|------|
| **配置加密** | AES-256-GCM 加密存储 API Key 和 Token |
| **命令别名** | `sandbox` → `sb`, `delete` → `rm/del` |
| **Shell 补全** | Bash/Zsh/Fish 自动补全 |
| **环境变量文件** | 支持 `.env` 文件导入 |
| **网络重试** | 指数退避自动重试 |
| **删除确认** | 危险操作二次确认 |
| **实时日志** | `codepod sandbox logs --follow` |
| **指标展示** | CPU/内存历史图表 |
| **TTY/PTY** | 完整终端仿真支持 |
