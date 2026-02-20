import { APIClient, getAPIClient } from '../api/client';
import { SSHService } from '../services/ssh';
import { WorkspaceMeta, Sandbox, Volume } from '../types';
import { configManager } from '../config';

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
  private client: APIClient;

  constructor(client?: APIClient) {
    this.registry = configManager.getRegistry();
    this.client = client || getAPIClient();
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
    console.log(`Volume created: ${volume.volumeId}`);
    console.log('');

    // Step 2: Create builder sandbox
    console.log('Creating builder sandbox...');
    const builder = await this.client.createSandbox({
      name: `devpod-${name}-builder`,
      image: this.builderImage,
      cpu: options.builderCpu || 2,
      memory: options.builderMemory || '4Gi',
      volumes: [{ volumeId: volume.volumeId, mountPath: '/workspace' }]
    });
    console.log(`Builder sandbox created: ${builder.id}`);
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
      imageRef: `${this.registry}/devpod/${name}:latest`
    };
    this.client.saveWorkspaceMeta(meta);

    try {
      // Step 3: Build image
      console.log('Building image...');
      await this.buildImage(builder, volume.volumeId, options);
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
        volumes: [{ volumeId: volume.volumeId, mountPath: '/workspace' }]
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
        await this.client.deleteVolume(volume.volumeId);
      } catch (e) {
        // Ignore cleanup errors
      }
      this.client.deleteWorkspaceMeta(name);
      throw error;
    }
  }

  private async buildImage(
    sandbox: Sandbox,
    _volumeId: string,
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

// Singleton instance - lazily created
let workspaceManagerInstance: WorkspaceManager | null = null;

export function getWorkspaceManager(): WorkspaceManager {
  if (!workspaceManagerInstance) {
    workspaceManagerInstance = new WorkspaceManager();
  }
  return workspaceManagerInstance;
}
