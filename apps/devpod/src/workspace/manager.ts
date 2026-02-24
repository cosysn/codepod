import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Sandbox } from '@codepod/sdk-ts';
import { Client } from 'ssh2';
import {
  createSandbox,
  createSandboxAndWait,
  getSandbox,
  getSandboxToken,
  deleteSandbox,
  stopSandbox,
  startSandbox,
  createVolume,
  deleteVolume,
  saveWorkspaceMeta,
  loadWorkspaceMeta,
  deleteWorkspaceMeta,
  listWorkspaces
} from '../api/client';
import { WorkspaceMeta } from '../types';
import { configManager } from '../config';
import { ImageResolver } from '../image';

export interface BuildOptions {
  repoUrl: string;
  name: string;
  dockerfilePath?: string;
  builderCpu?: number;
  builderMemory?: string;
  devCpu?: number;
  devMemory?: string;
  devImage?: string; // Optional dev container image to use
}

export class WorkspaceManager {
  private builderImage: string;
  private registry: string;
  private imageResolver: ImageResolver;

  constructor() {
    this.registry = configManager.getRegistry();
    // TODO: Fix - use ubuntu temporarily until devcontainer image is rebuilt properly
    // Use ubuntu-builder which has git and can install openssh-client for SSH git access
    this.builderImage = `localhost:5000/codepod/ubuntu-builder:latest`;
    this.imageResolver = new ImageResolver({
      preferCache: true,
      cacheRegistry: this.registry,
      fallbackRegistries: ['docker.io'],
      prefixMappings: {},
    });
  }

  async create(options: BuildOptions): Promise<void> {
    const { repoUrl, name } = options;

    console.log(`Creating workspace: ${name}`);
    console.log(`Repository: ${repoUrl}`);
    console.log('');

    // Step 1: Create volume
    console.log('Creating shared volume...');
    const volume = await createVolume({
      name: `devpod-${name}`,
      size: '10Gi'
    });
    console.log(`Volume created: ${volume.volumeId}`);
    console.log('');

    // Step 2: Create builder sandbox and wait for it to be running
    console.log('Creating builder sandbox...');
    const builder = await createSandboxAndWait({
      name: `devpod-${name}-builder`,
      image: this.builderImage,
      cpu: options.builderCpu || 2,
      memory: options.builderMemory || '4Gi',
      volumes: [{ volumeId: volume.volumeId, mountPath: '/workspace' }]
    }, 180); // 3 minutes timeout
    console.log(`Builder sandbox created: ${builder.id}`);
    console.log(`Builder SSH: ${builder.host}:${builder.port}`);
    console.log('');

    // Copy SSH credentials before git clone
    await copyCredentialsToSandbox(builder);

    // Save metadata
    const meta: WorkspaceMeta = {
      name,
      id: `${Date.now()}`,
      createdAt: new Date().toISOString(),
      status: 'building',
      volumeId: volume.volumeId,
      builderSandboxId: builder.id,
      gitUrl: repoUrl,
      imageRef: `${this.registry}/workspace/${name}:latest`
    };
    saveWorkspaceMeta(meta);

    try {
      // Step 3: Build image
      console.log('Building image...');
      await this.buildImage(builder, volume.volumeId, options);
      console.log('Image built successfully!');
      console.log('');

      // Step 4: Delete builder
      console.log('Cleaning up builder...');
      await deleteSandbox(builder.id);
      meta.builderSandboxId = undefined;
      console.log('');

      // Step 5: Create dev sandbox and wait for it to be running
      console.log('Creating dev sandbox...');

      // Resolve dev image using ImageResolver if specified
      let devImage: string;
      if (options.devImage) {
        const resolved = await this.imageResolver.getImage(options.devImage);
        devImage = resolved.fullName;
        console.log(`Using resolved dev image: ${devImage}`);
      } else {
        devImage = `${this.registry}/workspace/${name}:latest`;
      }

      const dev = await createSandboxAndWait({
        name: `devpod-${name}`,
        image: devImage,
        cpu: options.devCpu || 2,
        memory: options.devMemory || '4Gi',
        volumes: [{ volumeId: volume.volumeId, mountPath: '/workspace' }]
      }, 180);
      console.log(`Dev sandbox created: ${dev.id}`);
      console.log(`Dev SSH: ${dev.host}:${dev.port}`);

      // Copy SSH credentials to dev sandbox for git operations
      await copyCredentialsToSandbox(dev);
      console.log('');

      // Update metadata
      meta.devSandboxId = dev.id;
      meta.imageRef = `${this.registry}/workspace/${name}:latest`;
      meta.status = 'running';
      saveWorkspaceMeta(meta);

      console.log('Workspace ready!');
      console.log(`Sandbox: ${dev.id}`);
      console.log('');

    } catch (error) {
      // Cleanup on failure
      console.error('Build failed:', error);
      try {
        await deleteSandbox(builder.id);
        await deleteVolume(volume.volumeId);
      } catch (e) {
        console.error('Cleanup error:', e);
      }
      deleteWorkspaceMeta(name);
      throw error;
    }
  }

  private async runCommandWithLogs(
    sandbox: Sandbox,
    cmd: string,
    options?: { timeout?: number; cwd?: string }
  ): Promise<number> {
    // The SDK handles connection retry automatically, no need to explicitly close
    try {
      const result = await sandbox.commands.run(cmd, {
        timeout: options?.timeout || 600000,
        cwd: options?.cwd,
        onStdout: (data: string) => process.stdout.write(data),
        onStderr: (data: string) => process.stderr.write(data)
      });

      if (result.exitCode !== 0) {
        throw new Error(`Command failed with exit code ${result.exitCode}`);
      }
      return result.exitCode;
    } catch (error: any) {
      // If gRPC fails, try SSH fallback
      const isGRPCError = error?.message?.includes('Failed to connect') ||
                         error?.message?.includes('deadline') ||
                         error?.code === 'RESOURCE_EXHAUSTED';

      if (isGRPCError) {
        console.warn('gRPC failed, trying SSH fallback...');
        const token = await getSandboxToken(sandbox.id);
        const sshResult = await runCommandViaSSH(
          'localhost', 2222, token,
          cmd,
          { timeout: options?.timeout || 600000, cwd: options?.cwd }
        );
        if (sshResult.exitCode !== 0) {
          throw new Error(`Command failed with exit code ${sshResult.exitCode}`);
        }
        return sshResult.exitCode;
      }
      throw error;
    }
  }

  private async buildImage(
    sandbox: Sandbox,
    volumeId: string,
    options: BuildOptions
  ): Promise<void> {
    // Test connection and retry if needed
    for (let i = 0; i < 3; i++) {
      try {
        await sandbox.commands.run('echo test', { timeout: 30000 });
        break;
      } catch (e: any) {
        console.warn(`Connection test failed (attempt ${i+1}/3):`, e.message);
        if (i < 2) {
          await new Promise(r => setTimeout(r, 3000));
        }
      }
    }

    try {
      // Clone repository - try HTTPS first, fall back to SSH if needed
      console.log('Cloning repository...');
      // Remove existing directory if present (for retry scenarios)
      let cloneCmd = `rm -rf /workspace/repo && git clone -q --depth 1 ${options.repoUrl} /workspace/repo 2>&1`;

      // Handle different Git URL formats
      // SSH format: git@github.com:user/repo.git -> convert to HTTPS
      // HTTPS format: https://github.com/user/repo.git -> use as-is
      // SSH with ssh://: ssh://git@github.com/user/repo.git -> convert to HTTPS
      let repoUrl = options.repoUrl;
      if (options.repoUrl.includes('git@') && !options.repoUrl.includes('ssh://')) {
        // Convert SSH URL to HTTPS
        // git@gitee.com:cosysn/codepod.git -> https://gitee.com/cosysn/codepod.git
        repoUrl = 'https://' + options.repoUrl.replace('git@', '').replace(':', '/');
        console.log('Converting SSH URL to HTTPS for git clone');
      } else if (options.repoUrl.includes('ssh://')) {
        // Convert ssh:// URLs to HTTPS
        repoUrl = options.repoUrl.replace('ssh://git@', 'https://').replace('ssh://', 'https://');
      }
      cloneCmd = `rm -rf /workspace/repo && git clone -q --depth 1 ${repoUrl} /workspace/repo 2>&1`;
      await this.runCommandWithLogs(sandbox, cloneCmd);

      // Verify clone succeeded
      console.log('Verifying repository clone...');
      const verifyCmd = `test -d /workspace/repo/.git && test -f /workspace/repo/.devcontainer/devcontainer.json`;
      await this.runCommandWithLogs(sandbox, verifyCmd);

      // Build image with envbuilder
      // For container networking: use localhost:5000 since builder uses host network
      const containerRegistry = 'localhost:5000';
      const imageName = `workspace/${options.name}:latest`;
      const fullImageName = `${containerRegistry}/${imageName}`;

      console.log('Building image with docker...');
      // Use docker build instead of kaniko to avoid kaniko registry mirror bug
      // Pre-pull base image first
      const baseImage = '10.0.0.15:5000/codepod/devcontainer:v12';
      const prePullCmd = `docker pull ${baseImage}`;
      await this.runCommandWithLogs(sandbox, prePullCmd);

      // Build with docker
      const buildCmd = `cd /workspace/repo && docker build -t ${fullImageName} -f .devcontainer/Dockerfile .`;
      await this.runCommandWithLogs(sandbox, buildCmd, { cwd: '/workspace' });

      // Push to registry
      const pushCmd = `docker push ${fullImageName}`;
      await this.runCommandWithLogs(sandbox, pushCmd);

      console.log('Image built successfully!');

    } catch (error) {
      throw new Error(`Build failed: ${error}`);
    }
  }

  /**
   * Resolve registry address for container networking
   * Since builder uses host network mode, we use localhost directly
   * (host.docker.internal doesn't work with host network mode)
   * Note: Strips /v2 suffix as it's the API path, not part of the image name
   */
  private resolveRegistryForContainer(registry: string): string {
    // For host network mode, use localhost directly
    // (host.docker.internal doesn't work with host network mode)
    // Just remove /v2 suffix
    let result = registry;

    // Remove /v2 suffix if present (it's the API path, not part of image name)
    if (result.endsWith('/v2')) {
      result = result.slice(0, -3);
    }

    return result;
  }

  /**
   * Convert HTTPS GitHub URL to SSH URL
   * e.g., https://github.com/cosysn/codepod -> git@github.com:cosysn/codepod
   */
  private convertToSSHUrl(httpsUrl: string): string {
    // Check if it's a GitHub HTTPS URL
    const match = httpsUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/.]+)(\.git)?$/);
    if (match) {
      const org = match[1];
      const repo = match[2];
      return `git@github.com:${org}/${repo}.git`;
    }
    // Return original URL if not a GitHub HTTPS URL
    return httpsUrl;
  }

  async list(): Promise<void> {
    const workspaces = listWorkspaces();
    if (workspaces.length === 0) {
      console.log('No workspaces found.');
      return;
    }

    console.log('Workspaces:');
    console.log('---');
    for (const name of workspaces) {
      const meta = loadWorkspaceMeta(name);
      if (meta) {
        const status = meta.status || 'unknown';
        console.log(`${name} (${status}) - ${meta.gitUrl || 'no repo'}`);
      }
    }
  }

  async delete(name: string): Promise<void> {
    const meta = loadWorkspaceMeta(name);
    if (!meta) {
      console.log(`Workspace ${name} not found.`);
      return;
    }

    // Delete dev sandbox
    if (meta.devSandboxId) {
      console.log('Deleting dev sandbox...');
      await deleteSandbox(meta.devSandboxId);
    }

    // Delete builder sandbox
    if (meta.builderSandboxId) {
      console.log('Deleting builder sandbox...');
      await deleteSandbox(meta.builderSandboxId);
    }

    // Delete volume
    if (meta.volumeId) {
      console.log('Deleting volume...');
      await deleteVolume(meta.volumeId);
    }

    // Delete metadata
    deleteWorkspaceMeta(name);
    console.log(`Workspace ${name} deleted.`);
  }

  async stop(name: string): Promise<void> {
    const meta = loadWorkspaceMeta(name);
    if (!meta || !meta.devSandboxId) {
      console.log(`Workspace ${name} not found or not running.`);
      return;
    }

    await stopSandbox(meta.devSandboxId);
    meta.status = 'stopped';
    saveWorkspaceMeta(meta);
    console.log(`Workspace ${name} stopped.`);
  }

  async start(name: string): Promise<void> {
    const meta = loadWorkspaceMeta(name);
    if (!meta || !meta.devSandboxId) {
      console.log(`Workspace ${name} not found.`);
      return;
    }

    await startSandbox(meta.devSandboxId);
    meta.status = 'running';
    saveWorkspaceMeta(meta);
    console.log(`Workspace ${name} started.`);
  }
}

// Singleton instance
let workspaceManagerInstance: WorkspaceManager | null = null;

export function getWorkspaceManager(): WorkspaceManager {
  if (!workspaceManagerInstance) {
    workspaceManagerInstance = new WorkspaceManager();
  }
  return workspaceManagerInstance;
}

/**
 * Validate path to prevent command injection
 */
function validatePath(input: string, name: string): void {
  // Only allow alphanumeric, dash, underscore, dot, and forward slash
  if (!/^[a-zA-Z0-9_./-]+$/.test(input)) {
    throw new Error(`Invalid path characters in ${name}: ${input}`);
  }
}

/**
 * Copy SSH credentials and gitconfig from local machine to sandbox
 * Uses tar + base64 to transfer entire directory in one command
 */
async function copyCredentialsToSandbox(sandbox: Sandbox): Promise<void> {
  const homeDir = os.homedir();
  const sshDir = path.join(homeDir, '.ssh');
  const gitconfigPath = path.join(homeDir, '.gitconfig');

  console.log('Copying SSH credentials to sandbox...');

  try {
    // Wait for sandbox to be ready
    console.log('Waiting for sandbox agent to initialize...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Get token for SSH fallback
    const token = await getSandboxToken(sandbox.id);

    // Use gRPC first, fallback to SSH
    try {
      // Copy SSH directory using tar + base64
      if (fs.existsSync(sshDir)) {
        const tarCmd = `cd /root && tar -cf - -C ${homeDir} .ssh 2>/dev/null | base64 -w0`;
        const content = execSync(tarCmd);
        await sandbox.commands.run(
          `mkdir -p /root/.ssh && printf '%s' '${content}' | base64 -d | tar -xf - -C /root && chmod 700 /root/.ssh && chmod 600 /root/.ssh/id_* 2>/dev/null || true`,
          { timeout: 30000 }
        );
      }

      // Copy .gitconfig
      if (fs.existsSync(gitconfigPath)) {
        const content = fs.readFileSync(gitconfigPath).toString('base64');
        await sandbox.commands.run(
          `printf '%s' '${content}' | base64 -d > /root/.gitconfig && chmod 644 /root/.gitconfig`,
          { timeout: 10000 }
        );
      }
    } catch (err: any) {
      console.warn('gRPC failed, using SSH fallback...');
      // Fallback to SSH for credentials
      if (fs.existsSync(sshDir)) {
        const tarCmd = `cd /root && tar -cf - -C ${homeDir} .ssh 2>/dev/null | base64 -w0`;
        const content = execSync(tarCmd);
        await runCommandViaSSH('localhost', 2222, token,
          `mkdir -p /root/.ssh && printf '%s' '${content}' | base64 -d | tar -xf - -C /root && chmod 700 /root/.ssh && chmod 600 /root/.ssh/id_* 2>/dev/null || true`,
          { timeout: 30000 }
        );
      }
      if (fs.existsSync(gitconfigPath)) {
        const content = fs.readFileSync(gitconfigPath).toString('base64');
        await runCommandViaSSH('localhost', 2222, token,
          `printf '%s' '${content}' | base64 -d > /root/.gitconfig && chmod 644 /root/.gitconfig`,
          { timeout: 10000 }
        );
      }
    }

    console.log('SSH credentials copied successfully');
  } catch (error) {
    console.warn('Failed to copy SSH credentials:', error);
    console.warn('Continuing without SSH credentials...');
  }
}

/**
 * Execute command via SSH (fallback when gRPC fails)
 */
async function runCommandViaSSH(
  host: string,
  port: number,
  password: string,
  command: string,
  options?: { timeout?: number; cwd?: string }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const timeout = options?.timeout || 60000;

    const timeoutHandle = setTimeout(() => {
      conn.end();
      reject(new Error(`Command timed out after ${timeout}ms`));
    }, timeout);

    conn.on('ready', () => {
      const cwd = options?.cwd || '/root';
      conn.exec(`cd ${cwd} && ${command}`, (err, stream) => {
        if (err) {
          clearTimeout(timeoutHandle);
          conn.end();
          reject(err);
          return;
        }

        let stdout = '';
        let stderr = '';

        stream.on('close', (code: number) => {
          clearTimeout(timeoutHandle);
          conn.end();
          resolve({ stdout, stderr, exitCode: code || 0 });
        });

        stream.on('data', (data: Buffer) => {
          stdout += data.toString();
          process.stdout.write(data);
        });

        stream.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
          process.stderr.write(data);
        });
      });
    });

    conn.on('error', (err) => {
      clearTimeout(timeoutHandle);
      reject(err);
    });

    conn.connect({
      host,
      port,
      username: 'root',
      password,
      readyTimeout: 30000,
    });
  });
}

/**
 * Execute command locally and return output
 */
function execSync(cmd: string): string {
  const { execSync: sync } = require('child_process');
  return sync(cmd, { encoding: 'utf-8' }).trim();
}

/**
 * Copy directory contents and set permissions
 */
async function copyDirectoryWithPermissions(
  sandbox: Sandbox,
  localDir: string,
  remoteDir: string
): Promise<void> {
  try {
    // Validate paths to prevent command injection
    validatePath(remoteDir, 'remoteDir');

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
  } catch (error) {
    throw new Error(`Failed to copy directory ${localDir}: ${error}`);
  }
}

/**
 * Copy single file and set permissions
 */
async function copyFileWithPermissions(
  sandbox: Sandbox,
  localPath: string,
  remotePath: string
): Promise<void> {
  try {
    // Check if file exists
    if (!fs.existsSync(localPath)) {
      console.log(`Skipping non-existent file: ${localPath}`);
      return;
    }

    // Validate paths to prevent command injection
    validatePath(remotePath, 'remotePath');

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
  } catch (error) {
    throw new Error(`Failed to copy file ${localPath}: ${error}`);
  }
}
