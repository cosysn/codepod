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
      // Clone repository
      console.log('Cloning repository...');
      const cloneCmd = `git clone --depth 1 ${options.repoUrl} /workspace/repo`;
      await this.runCommandWithLogs(sandbox, cloneCmd);

      // Build image with envbuilder
      const containerRegistry = this.resolveRegistryForContainer(this.registry);
      const imageName = `workspace/${options.name}:latest`;
      const fullImageName = `${containerRegistry}/${imageName}`;

      console.log('Building image with envbuilder...');
      const buildCmd = `envbuilder build --workspace /workspace/repo --image ${fullImageName} --push`;
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
