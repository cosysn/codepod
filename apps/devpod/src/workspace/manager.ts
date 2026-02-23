import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Sandbox } from '@codepod/sdk-ts';
import {
  createSandbox,
  createSandboxAndWait,
  getSandbox,
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
    this.builderImage = `10.0.0.15:5000/codepod/devcontainer:v11`;
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
    console.log('');

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
    return new Promise((resolve, reject) => {
      let exitCode = 0;
      sandbox.commands.run(cmd, {
        timeout: options?.timeout || 600000,
        cwd: options?.cwd,
        onStdout: (data: string) => process.stdout.write(data),
        onStderr: (data: string) => process.stderr.write(data)
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

  private async buildImage(
    sandbox: Sandbox,
    volumeId: string,
    options: BuildOptions
  ): Promise<void> {
    try {
      // Clone repository - try HTTPS first, fall back to SSH if needed
      console.log('Cloning repository...');
      let cloneCmd = `git clone --depth 1 ${options.repoUrl} /workspace/repo`;

      // Check if we should use SSH (if HTTPS fails, user can provide SSH URL)
      if (options.repoUrl.includes('git@') || options.repoUrl.includes('ssh://')) {
        // Use SSH with host key checking disabled
        cloneCmd = `GIT_SSH_COMMAND="ssh -o StrictHostKeyChecking=no" git clone --depth 1 ${options.repoUrl} /workspace/repo`;
      }
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

      console.log('Building image with envbuilder...');
      const buildCmd = `envbuilder build --workspace /workspace/repo --image ${fullImageName} --registry ${containerRegistry}`;
      await this.runCommandWithLogs(sandbox, buildCmd, { cwd: '/workspace' });

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
