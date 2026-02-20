# DevPod MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a CLI tool that creates development environments from Git repositories using CodePod Sandbox, with automatic VS Code Remote connection.

**Architecture:**
- CLI tool built with TypeScript/Commander.js
- Uses CodePod Sandbox API for container management
- SSH-based builder execution for image construction
- Shared volumes for code persistence between build and dev phases

**Tech Stack:** TypeScript, Node.js, Commander.js, ssh2, axios

---

## Pre-requisites

Before starting implementation, verify these CodePod APIs exist:
1. Volume management API (`POST/DELETE /api/v1/volumes`)
2. Sandbox creation with volume mounts
3. Docker Registry integration

---

## Plan Execution Location

**Worktree:** `/home/ubuntu/codepod-worktrees/devpod-mvp`

All file paths in this plan are relative to the worktree root.

---

## Task 1: Initialize DevPod Project Structure

**Files:**
- Create: `apps/devpod/package.json`
- Create: `apps/devpod/tsconfig.json`
- Create: `apps/devpod/src/index.ts`
- Create: `apps/devpod/src/config.ts`
- Create: `apps/devpod/.gitignore`

**Step 1: Create package.json**

```json
{
  "name": "devpod",
  "version": "0.1.0",
  "description": "Development environment manager using CodePod Sandbox",
  "main": "dist/index.js",
  "bin": {
    "devpod": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "ts-node src/index.ts"
  },
  "dependencies": {
    "axios": "^1.6.0",
    "commander": "^11.1.0",
    "inquirer": "^9.2.0",
    "ssh2": "^1.15.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/ssh2": "^1.15.0",
    "ts-node": "^10.9.0",
    "typescript": "^5.0.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create src/index.ts**

```typescript
#!/usr/bin/env node
import { Command } from 'commander';
import { config } from './config';
import up from './commands/up';
import list from './commands/list';
import deleteCmd from './commands/delete';
import stop from './commands/stop';
import start from './commands/start';

const program = new Command();

program
  .name('devpod')
  .description('Development environment manager using CodePod Sandbox')
  .version('0.1.0');

program.addCommand(up);
program.addCommand(list);
program.addCommand(deleteCmd);
program.addCommand(stop);
program.addCommand(start);

program.parse();
```

**Step 4: Create src/config.ts**

```typescript
import * as fs from 'fs';
import * as path from 'path';

const CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '/root', '.devpod');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export interface DevPodConfig {
  endpoint: string;
  registry: string;
}

export class ConfigManager {
  private static instance: ConfigManager;

  private constructor() {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
  }

  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  load(): DevPodConfig {
    try {
      const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
      return JSON.parse(data);
    } catch {
      return { endpoint: '', registry: '' };
    }
  }

  save(config: DevPodConfig): void {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  }

  getEndpoint(): string {
    const cfg = this.load();
    return cfg.endpoint;
  }

  getRegistry(): string {
    const cfg = this.load();
    return cfg.registry || 'localhost:5000';
  }
}

export const configManager = ConfigManager.getInstance();
```

**Step 5: Create .gitignore**

```
node_modules/
dist/
.env
*.log
```

**Step 6: Run npm install and build**

```bash
cd apps/devpod
npm install
npm run build
```

**Step 7: Verify build**

```bash
ls -la dist/
```

Expected: `index.js`, `config.js`, `index.d.ts` exist

---

## Task 2: Create API Client

**Files:**
- Create: `apps/devpod/src/api/client.ts`
- Create: `apps/devpod/src/types/index.ts`

**Step 1: Create src/types/index.ts**

```typescript
export interface Sandbox {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'stopped' | 'failed';
  image: string;
  host: string;
  port: number;
  user: string;
  token?: string;
}

export interface Volume {
  id: string;
  name: string;
  size: string;
  hostPath: string;
}

export interface CreateSandboxRequest {
  name: string;
  image: string;
  cpu?: number;
  memory?: string;
  volumes?: Array<{
    volumeId: string;
    mountPath: string;
  }>;
}

export interface CreateVolumeRequest {
  name: string;
  size: string;
}

export interface WorkspaceMeta {
  name: string;
  id: string;
  createdAt: string;
  status: 'pending' | 'building' | 'running' | 'stopped';
  devSandboxId?: string;
  builderSandboxId?: string;
  volumeId?: string;
  imageRef?: string;
  gitUrl?: string;
}
```

**Step 2: Create src/api/client.ts**

```typescript
import axios, { AxiosInstance } from 'axios';
import { configManager } from '../config';
import {
  Sandbox,
  Volume,
  CreateSandboxRequest,
  CreateVolumeRequest,
  WorkspaceMeta
} from '../types';

const WORKSPACES_DIR = require('path').join(
  process.env.HOME || process.env.USERPROFILE || '/root',
  '.devpod',
  'workspaces'
);

export class APIClient {
  private client: AxiosInstance;

  constructor(endpoint?: string) {
    const config = configManager.load();
    const baseURL = endpoint || config.endpoint;

    this.client = axios.create({
      baseURL,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  // Sandbox operations
  async createSandbox(req: CreateSandboxRequest): Promise<Sandbox> {
    const response = await this.client.post<Sandbox>('/api/v1/sandboxes', req);
    return response.data;
  }

  async getSandbox(id: string): Promise<Sandbox | null> {
    try {
      const response = await this.client.get<Sandbox>(`/api/v1/sandboxes/${id}`);
      return response.data;
    } catch {
      return null;
    }
  }

  async deleteSandbox(id: string): Promise<void> {
    await this.client.delete(`/api/v1/sandboxes/${id}`);
  }

  async stopSandbox(id: string): Promise<void> {
    await this.client.post(`/api/v1/sandboxes/${id}/stop`);
  }

  async startSandbox(id: string): Promise<void> {
    await this.client.post(`/api/v1/sandboxes/${id}/start`);
  }

  async getToken(id: string): Promise<string> {
    const response = await this.client.post<{ token: string }>(`/api/v1/sandboxes/${id}/token`);
    return response.data.token;
  }

  // Volume operations
  async createVolume(req: CreateVolumeRequest): Promise<Volume> {
    const response = await this.client.post<Volume>('/api/v1/volumes', req);
    return response.data;
  }

  async deleteVolume(id: string): Promise<void> {
    await this.client.delete(`/api/v1/volumes/${id}`);
  }

  // Workspace metadata
  saveWorkspaceMeta(meta: WorkspaceMeta): void {
    const fs = require('fs');
    if (!fs.existsSync(WORKSPACES_DIR)) {
      fs.mkdirSync(WORKSPACES_DIR, { recursive: true });
    }
    const file = require('path').join(WORKSPACES_DIR, `${meta.name}.json`);
    fs.writeFileSync(file, JSON.stringify(meta, null, 2));
  }

  loadWorkspaceMeta(name: string): WorkspaceMeta | null {
    try {
      const fs = require('fs');
      const file = require('path').join(WORKSPACES_DIR, `${name}.json`);
      const data = fs.readFileSync(file, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  listWorkspaces(): string[] {
    try {
      const fs = require('fs');
      if (!fs.existsSync(WORKSPACES_DIR)) {
        return [];
      }
      return fs.readdirSync(WORKSPACES_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''));
    } catch {
      return [];
    }
  }

  deleteWorkspaceMeta(name: string): void {
    const fs = require('fs');
    const file = require('path').join(WORKSPACES_DIR, `${name}.json`);
    try {
      fs.unlinkSync(file);
    } catch (e) {
      // Ignore if file doesn't exist
    }
  }
}

export const apiClient = new APIClient();
```

---

## Task 3: Create SSH Service

**Files:**
- Create: `apps/devpod/src/services/ssh.ts`

**Step 1: Create src/services/ssh.ts**

```typescript
import { Client, ConnectConfig, ClientChannel } from 'ssh2';

export interface SSHConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class SSHService {
  private conn: Client | null = null;
  private config: SSHConfig;

  constructor(config: SSHConfig) {
    this.config = {
      readyTimeout: 30000,
      timeout: 60000,
      ...config
    };
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.conn = new Client();

      const connectConfig: ConnectConfig = {
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        readyTimeout: this.config.readyTimeout,
        timeout: this.config.timeout,
      };

      if (this.config.password) {
        connectConfig.password = this.config.password;
      }

      if (this.config.privateKey) {
        connectConfig.privateKey = this.config.privateKey;
      }

      this.conn.on('ready', () => {
        resolve();
      }).on('error', (err) => {
        reject(new Error(`SSH connection failed: ${err.message}`));
      }).connect(connectConfig);
    });
  }

  async exec(command: string): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      if (!this.conn) {
        reject(new Error('Not connected'));
        return;
      }

      this.conn.exec(command, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        let stdout = '';
        let stderr = '';

        stream.on('close', (code: number) => {
          resolve({
            stdout,
            stderr,
            exitCode: code || 0
          });
        }).on('data', (data: Buffer) => {
          stdout += data.toString();
        }).stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });
      });
    });
  }

  async execStream(command: string, onData: (data: string) => void): Promise<number> {
    return new Promise((resolve, reject) => {
      if (!this.conn) {
        reject(new Error('Not connected'));
        return;
      }

      this.conn.exec(command, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        stream.on('close', (code: number) => {
          resolve(code || 0);
        }).on('data', (data: Buffer) => {
          onData(data.toString());
        }).stderr.on('data', (data: Buffer) => {
          onData(data.toString());
        });
      });
    });
  }

  async shell(): Promise<ClientChannel> {
    return new Promise((resolve, reject) => {
      if (!this.conn) {
        reject(new Error('Not connected'));
        return;
      }

      this.conn.shell((err, stream) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(stream);
      });
    });
  }

  disconnect(): void {
    if (this.conn) {
      this.conn.end();
      this.conn = null;
    }
  }

  static async connectWithPassword(
    host: string,
    port: number,
    username: string,
    password: string
  ): Promise<SSHService> {
    const ssh = new SSHService({ host, port, username, password });
    await ssh.connect();
    return ssh;
  }
}
```

---

## Task 4: Create Workspace Manager

**Files:**
- Create: `apps/devpod/src/workspace/manager.ts`

**Step 1: Create src/workspace/manager.ts**

```typescript
import { apiClient, APIClient } from '../api/client';
import { SSHService } from '../services/ssh';
import { WorkspaceMeta, Sandbox, Volume } from '../types';
import * as readline from 'readline';

export interface BuildOptions {
  repoUrl: string;
  name: string;
  dockerfilePath?: string;
  builderCpu?: number;
  builderMemory?: string;
  devCpu?: number;
  devMemory?: string;
}

export class WorkspaceManager {
  private builderImage = 'codepod/builder:latest';
  private registry: string;

  constructor(private client: APIClient = apiClient) {
    this.registry = require('../config').configManager.getRegistry();
  }

  async create(options: BuildOptions): Promise<void> {
    const { repoUrl, name } = options;

    console.log(`Creating workspace: ${name}`);
    console.log(`Repository: ${repoUrl}`);
    console.log('');

    // Step 1: Create volume
    console.log('Creating shared volume...');
    const volume = await this.client.createVolume({
      name: `devpod-${name}`,
      size: '10Gi'
    });
    console.log(`Volume created: ${volume.id}`);
    console.log('');

    // Step 2: Create builder sandbox
    console.log('Creating builder sandbox...');
    const builder = await this.client.createSandbox({
      name: `devpod-${name}-builder`,
      image: this.builderImage,
      cpu: options.builderCpu || 2,
      memory: options.builderMemory || '4Gi',
      volumes: [{ volumeId: volume.id, mountPath: '/workspace' }]
    });
    console.log(`Builder sandbox created: ${builder.id}`);
    console.log('');

    // Save metadata
    const meta: WorkspaceMeta = {
      name,
      id: `${Date.now()}`,
      createdAt: new Date().toISOString(),
      status: 'building',
      volumeId: volume.id,
      builderSandboxId: builder.id,
      gitUrl: repoUrl,
      imageRef: `${this.registry}/devpod/${name}:latest`
    };
    this.client.saveWorkspaceMeta(meta);

    try {
      // Step 3: Build image
      console.log('Building image...');
      await this.buildImage(builder, volume.id, options);
      console.log('Image built successfully!');
      console.log('');

      // Step 4: Delete builder
      console.log('Cleaning up builder...');
      await this.client.deleteSandbox(builder.id);
      meta.builderSandboxId = undefined;
      console.log('');

      // Step 5: Create dev sandbox
      console.log('Creating dev sandbox...');
      const dev = await this.client.createSandbox({
        name: `devpod-${name}`,
        image: `${this.registry}/devpod/${name}:latest`,
        cpu: options.devCpu || 2,
        memory: options.devMemory || '4Gi',
        volumes: [{ volumeId: volume.id, mountPath: '/workspace' }]
      });
      console.log(`Dev sandbox created: ${dev.id}`);
      console.log('');

      // Update metadata
      meta.devSandboxId = dev.id;
      meta.imageRef = `${this.registry}/devpod/${name}:latest`;
      meta.status = 'running';
      this.client.saveWorkspaceMeta(meta);

      console.log('Workspace ready!');
      console.log(`Sandbox: ${dev.id}`);
      console.log('');

    } catch (error) {
      // Cleanup on failure
      console.error('Build failed:', error);
      try {
        await this.client.deleteSandbox(builder.id);
        await this.client.deleteVolume(volume.id);
      } catch (e) {
        // Ignore cleanup errors
      }
      this.client.deleteWorkspaceMeta(name);
      throw error;
    }
  }

  private async buildImage(
    sandbox: Sandbox,
    volumeId: string,
    options: BuildOptions
  ): Promise<void> {
    // Connect to builder
    const token = await this.client.getToken(sandbox.id);
    const ssh = await SSHService.connectWithPassword(
      sandbox.host,
      sandbox.port,
      sandbox.user,
      token
    );

    try {
      // Clone repository
      console.log('Cloning repository...');
      const cloneCmd = `git clone --depth 1 ${options.repoUrl} /workspace/repo`;
      await ssh.exec(cloneCmd);

      // Build image
      const dockerfilePath = options.dockerfilePath || '/workspace/repo/.devcontainer/Dockerfile';
      const buildCmd = `cd /workspace && docker build -f ${dockerfilePath} -t ${this.registry}/devpod/${options.name}:latest /workspace/repo`;

      console.log('Building Docker image...');
      await ssh.execStream(buildCmd, (data) => {
        process.stdout.write(data);
      });

      // Push image
      console.log('Pushing image...');
      const pushCmd = `docker push ${this.registry}/devpod/${options.name}:latest`;
      await ssh.exec(pushCmd);

    } finally {
      ssh.disconnect();
    }
  }

  async list(): Promise<void> {
    const workspaces = this.client.listWorkspaces();
    if (workspaces.length === 0) {
      console.log('No workspaces found.');
      return;
    }

    console.log('Workspaces:');
    console.log('---');
    for (const name of workspaces) {
      const meta = this.client.loadWorkspaceMeta(name);
      if (meta) {
        const status = meta.status || 'unknown';
        console.log(`${name} (${status}) - ${meta.gitUrl || 'no repo'}`);
      }
    }
  }

  async delete(name: string): Promise<void> {
    const meta = this.client.loadWorkspaceMeta(name);
    if (!meta) {
      console.log(`Workspace ${name} not found.`);
      return;
    }

    // Delete dev sandbox
    if (meta.devSandboxId) {
      console.log('Deleting dev sandbox...');
      await this.client.deleteSandbox(meta.devSandboxId);
    }

    // Delete builder sandbox
    if (meta.builderSandboxId) {
      console.log('Deleting builder sandbox...');
      await this.client.deleteSandbox(meta.builderSandboxId);
    }

    // Delete volume
    if (meta.volumeId) {
      console.log('Deleting volume...');
      await this.client.deleteVolume(meta.volumeId);
    }

    // Delete metadata
    this.client.deleteWorkspaceMeta(name);
    console.log(`Workspace ${name} deleted.`);
  }

  async stop(name: string): Promise<void> {
    const meta = this.client.loadWorkspaceMeta(name);
    if (!meta || !meta.devSandboxId) {
      console.log(`Workspace ${name} not found or not running.`);
      return;
    }

    await this.client.stopSandbox(meta.devSandboxId);
    meta.status = 'stopped';
    this.client.saveWorkspaceMeta(meta);
    console.log(`Workspace ${name} stopped.`);
  }

  async start(name: string): Promise<void> {
    const meta = this.client.loadWorkspaceMeta(name);
    if (!meta || !meta.devSandboxId) {
      console.log(`Workspace ${name} not found.`);
      return;
    }

    await this.client.startSandbox(meta.devSandboxId);
    meta.status = 'running';
    this.client.saveWorkspaceMeta(meta);
    console.log(`Workspace ${name} started.`);
  }
}

export const workspaceManager = new WorkspaceManager();
```

---

## Task 5: Create Command Files

**Files:**
- Create: `apps/devpod/src/commands/up.ts`
- Create: `apps/devpod/src/commands/list.ts`
- Create: `apps/devpod/src/commands/delete.ts`
- Create: `apps/devpod/src/commands/stop.ts`
- Create: `apps/devpod/src/commands/start.ts`

**Step 1: Create src/commands/up.ts**

```typescript
import { Command } from 'commander';
import { workspaceManager } from '../workspace/manager';

const up = new Command('up')
  .description('Create workspace and open VS Code')
  .argument('<repo-url>', 'Git repository URL')
  .option('--name <name>', 'Workspace name (derived from repo if not specified)')
  .option('--cpu <cpu>', 'Builder CPU cores', '2')
  .option('--memory <memory>', 'Builder memory', '4Gi')
  .option('--dev-cpu <cpu>', 'Dev sandbox CPU cores', '2')
  .option('--dev-memory <memory>', 'Dev sandbox memory', '4Gi')
  .option('--dockerfile <path>', 'Path to Dockerfile', '.devcontainer/Dockerfile')
  .action(async (repoUrl, options) => {
    const name = options.name || extractNameFromRepo(repoUrl);

    try {
      await workspaceManager.create({
        repoUrl,
        name,
        builderCpu: parseInt(options.cpu),
        builderMemory: options.memory,
        devCpu: parseInt(options.devCpu),
        devMemory: options.devMemory,
        dockerfilePath: options.dockerfile
      });

      console.log('');
      console.log('Workspace created successfully!');
      console.log(`Run: devpod connect ${name}`);

    } catch (error) {
      console.error('Failed to create workspace:', error);
      process.exit(1);
    }
  });

function extractNameFromRepo(url: string): string {
  // Extract repo name from URL
  const match = url.match(/\/([^/]+)\/?$/);
  return match ? match[1].replace('.git', '') : 'workspace';
}

export default up;
```

**Step 2: Create src/commands/list.ts**

```typescript
import { Command } from 'commander';
import { workspaceManager } from '../workspace/manager';

const list = new Command('list')
  .description('List all workspaces')
  .action(async () => {
    await workspaceManager.list();
  });

export default list;
```

**Step 3: Create src/commands/delete.ts**

```typescript
import { Command } from 'commander';
import { workspaceManager } from '../workspace/manager';

const deleteCmd = new Command('delete')
  .alias('rm')
  .description('Delete a workspace')
  .argument('<name>', 'Workspace name')
  .action(async (name) => {
    try {
      await workspaceManager.delete(name);
    } catch (error) {
      console.error('Failed to delete workspace:', error);
      process.exit(1);
    }
  });

export default deleteCmd;
```

**Step 4: Create src/commands/stop.ts**

```typescript
import { Command } from 'commander';
import { workspaceManager } from '../workspace/manager';

const stop = new Command('stop')
  .description('Stop a running workspace')
  .argument('<name>', 'Workspace name')
  .action(async (name) => {
    try {
      await workspaceManager.stop(name);
    } catch (error) {
      console.error('Failed to stop workspace:', error);
      process.exit(1);
    }
  });

export default stop;
```

**Step 5: Create src/commands/start.ts**

```typescript
import { Command } from 'commander';
import { workspaceManager } from '../workspace/manager';

const start = new Command('start')
  .description('Start a stopped workspace')
  .argument('<name>', 'Workspace name')
  .action(async (name) => {
    try {
      await workspaceManager.start(name);
    } catch (error) {
      console.error('Failed to start workspace:', error);
      process.exit(1);
    }
  });

export default start;
```

---

## Task 6: Create VS Code Connector

**Files:**
- Create: `apps/devpod/src/services/vscode.ts`

**Step 1: Create src/services/vscode.ts**

```typescript
import { apiClient, APIClient } from '../api/client';
import { SSHService } from './ssh';
import * as childProcess from 'child_process';

export interface VSCodeConnectOptions {
  sandboxId: string;
  workspacePath?: string;
}

export class VSCodeConnector {
  constructor(private client: APIClient = apiClient) {}

  async connect(options: VSCodeConnectOptions): Promise<void> {
    const sandbox = await this.client.getSandbox(options.sandboxId);
    if (!sandbox) {
      throw new Error(`Sandbox ${options.sandboxId} not found`);
    }

    if (sandbox.status !== 'running') {
      throw new Error(`Sandbox ${options.sandboxId} is not running`);
    }

    const token = await this.client.getToken(sandbox.id);

    // Get or generate SSH key for VS Code
    const { execSync } = require('child_process');
    let privateKey = process.env.SSH_KEY;
    let publicKey = process.env.SSH_KEY_PUB;

    if (!privateKey) {
      // Generate key pair if not exists
      try {
        execSync('ssh-keygen -t ed25519 -f ~/.ssh/devpod -N ""', { stdio: 'ignore' });
        privateKey = execSync('cat ~/.ssh/devpod', { encoding: 'utf-8' }).trim();
        publicKey = execSync('cat ~/.ssh/devpod.pub', { encoding: 'utf-8' }).trim();
      } catch {
        throw new Error('Failed to generate SSH key. Please set SSH_KEY and SSH_KEY_PUB environment variables.');
      }
    }

    // Upload public key to sandbox (this requires sandbox support)
    // For now, we use password authentication with token

    // Build VS Code remote command
    const workspaceArg = options.workspacePath || '/workspace';
    const remoteArg = `ssh-remote+${sandbox.user}@${sandbox.host}:${sandbox.port}`;

    console.log('Opening VS Code...');
    console.log(`Workspace: ${workspaceArg}`);
    console.log(`Connecting to: ${sandbox.user}@${sandbox.host}:${sandbox.port}`);

    // Generate temporary SSH config
    const sshConfig = `
Host devpod-${sandbox.id}
  HostName ${sandbox.host}
  Port ${sandbox.port}
  User ${sandbox.user}
  PasswordAuthentication yes
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
`;

    // Write temp config and launch VS Code
    const tempConfig = '/tmp/devpod-ssh-config';
    require('fs').writeFileSync(tempConfig, sshConfig);

    try {
      childProcess.spawnSync('code', [
        '--remote',
        `ssh-remote+${sandbox.user}@${sandbox.host}:${sandbox.port}`,
        workspaceArg,
        '--folder-uri',
        `vscode-remote://${sandbox.host}:${sandbox.port}${workspaceArg}`
      ], {
        stdio: 'inherit'
      });
    } catch (error) {
      console.log('VS Code not found or failed to launch.');
      console.log('Manual connection:');
      console.log(`  Host: ${sandbox.host}`);
      console.log(`  Port: ${sandbox.port}`);
      console.log(`  User: ${sandbox.user}`);
      console.log(`  Password: ${token}`);
    }
  }
}

export const vscodeConnector = new VSCodeConnector();
```

---

## Task 7: Create Builder Docker Image

**Files:**
- Create: `apps/devpod/builder/Dockerfile`
- Create: `apps/devpod/builder/README.md`

**Step 1: Create builder/Dockerfile**

```dockerfile
# Builder image for DevPod
# Used to build container images from Dockerfiles

FROM ubuntu:22.04

# Install dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    curl \
    docker.io \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/run/docker \
    && chmod 666 /var/run/docker

# Create workspace directory
WORKDIR /workspace

# Default command
CMD ["/bin/bash"]
```

**Step 2: Create builder/README.md**

```markdown
# DevPod Builder Image

This image is used by DevPod to build container images from Dockerfiles.

## Features

- Git for cloning repositories
- Docker for building images
- No additional tools (minimal image)

## Usage

Used internally by DevPod CLI for building development environment images.

## Build

```bash
docker build -t codepod/builder:latest ./builder
```
```

---

## Task 8: Update Makefile

**Files:**
- Modify: `Makefile`

**Step 1: Add devpod build targets**

```makefile
# DevPod targets
build-devpod:
	@echo "Building DevPod..."
	cd apps/devpod && npm install && npm run build

devpod-publish-builder:
	@echo "Building and publishing builder image..."
	docker build -t codepod/builder:latest ./apps/devpod/builder
	docker tag codepod/builder:latest localhost:5000/codepod/builder:latest
	docker push localhost:5000/codepod/builder:latest

clean-devpod:
	@echo "Cleaning DevPod..."
	rm -rf apps/devpod/dist
	rm -rf apps/devpod/node_modules
```

---

## Task 9: Add to Root package.json (Optional Workspace)

**Files:**
- Modify: `package.json` (root)

**Step 1: Add devpod script**

```json
{
  "scripts": {
    "devpod:build": "cd apps/devpod && npm run build",
    "devpod:install": "cd apps/devpod && npm install"
  }
}
```

---

## Task 10: Create README

**Files:**
- Create: `apps/devpod/README.md`

**Step 1: Create apps/devpod/README.md**

```markdown
# DevPod

Development environment manager using CodePod Sandbox.

## Quick Start

```bash
# Configure CodePod endpoint
devpod config set endpoint http://localhost:8080

# Create workspace from Git repository
devpod up https://github.com/username/project
```

## Commands

| Command | Description |
|---------|-------------|
| `devpod up <repo-url>` | Create workspace and open VS Code |
| `devpod list` | List all workspaces |
| `devpod stop <name>` | Stop a workspace |
| `devpod start <name>` | Start a workspace |
| `devpod delete <name>` | Delete a workspace |

## Configuration

- `~/.devpod/config.json` - Global configuration
- `~/.devpod/workspaces/` - Workspace metadata

## Requirements

- CodePod Server running
- Docker Registry at localhost:5000
- Node.js 18+
```

---

## Task 11: Test the Implementation

**Step 1: Build DevPod**

```bash
cd apps/devpod
npm run build
```

**Step 2: Test CLI help**

```bash
node dist/index.js --help
```

Expected output:
```
Usage: devpod [options] [command]

Options:
  -V, --version   output the version number
  -h, --help      display help for command

Commands:
  up <repo-url>   Create workspace and open VS Code
  list            List all workspaces
  delete <name>   Delete a workspace
  stop <name>     Stop a workspace
  start <name>    Start a workspace
  help [command]  display help for command
```

**Step 3: Test config command**

```bash
node dist/index.js config set endpoint http://localhost:8080
cat ~/.devpod/config.json
```

Expected: Config file created with endpoint

---

## Summary

This plan implements a minimal DevPod CLI with:

1. **Project Structure**: TypeScript CLI with Commander.js
2. **API Client**: CodePod Sandbox integration
3. **SSH Service**: For executing commands in builder sandbox
4. **Workspace Manager**: Orchestrates the build → deploy flow
5. **Commands**: up, list, delete, stop, start
6. **VS Code Integration**: Launches VS Code Remote
7. **Builder Image**: Minimal Docker image for building

Total tasks: 11

**Plan complete and saved to `docs/plans/2026-02-20-devpod-implementation.md`.**

**Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
