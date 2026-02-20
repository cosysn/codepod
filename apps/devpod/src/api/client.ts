import * as path from 'path';
import * as fs from 'fs';
import { CodePodClient, CreateVolumeRequest, CreateVolumeResponse, Sandbox } from '@codepod/sdk-ts';
import { configManager } from '../config';
import { WorkspaceMeta } from '../types';

const WORKSPACES_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '/root',
  '.devpod',
  'workspaces'
);

function isWorkspaceMeta(obj: unknown): obj is WorkspaceMeta {
  if (obj && typeof obj === 'object') {
    const meta = obj as Record<string, unknown>;
    return (
      typeof meta.name === 'string' &&
      typeof meta.id === 'string' &&
      typeof meta.createdAt === 'string' &&
      typeof meta.status === 'string'
    );
  }
  return false;
}

export class APIClient {
  private client: CodePodClient | null = null;

  constructor(endpoint?: string) {
    const config = configManager.load();
    const baseURL = endpoint || config.endpoint;

    if (!baseURL) {
      throw new Error('API endpoint not configured. Run: devpod config set endpoint <url>');
    }

    const apiKey = process.env.CODEPOD_API_KEY;
    this.client = new CodePodClient({
      baseURL,
      apiKey,
      timeout: 30000
    });
  }

  getClient(): CodePodClient {
    if (!this.client) {
      const config = configManager.load();
      const baseURL = config.endpoint;

      if (!baseURL) {
        throw new Error('API endpoint not configured. Run: devpod config set endpoint <url>');
      }

      const apiKey = process.env.CODEPOD_API_KEY;
      this.client = new CodePodClient({
        baseURL,
        apiKey,
        timeout: 30000
      });
    }
    return this.client;
  }

  // Sandbox operations
  async createSandbox(req: { image: string; name?: string; cpu?: number; memory?: string; env?: Record<string, string>; timeout?: number; volumes?: { volumeId: string; mountPath: string }[] }): Promise<Sandbox> {
    const response = await this.getClient().createSandbox(req);
    return response.sandbox;
  }

  async getSandbox(id: string): Promise<Sandbox | null> {
    try {
      return await this.getClient().getSandbox(id);
    } catch {
      return null;
    }
  }

  async deleteSandbox(id: string): Promise<void> {
    await this.getClient().deleteSandbox(id);
  }

  async stopSandbox(id: string): Promise<void> {
    await this.getClient().stopSandbox(id);
  }

  async startSandbox(id: string): Promise<void> {
    // Start is not directly supported, use restart
    await this.getClient().restartSandbox(id);
  }

  async getToken(id: string): Promise<string> {
    const response = await this.getClient().getSandboxToken(id);
    return response.token;
  }

  // Volume operations
  async createVolume(req: CreateVolumeRequest): Promise<CreateVolumeResponse> {
    return await this.getClient().createVolume(req);
  }

  async deleteVolume(id: string): Promise<void> {
    await this.getClient().deleteVolume(id);
  }

  // Workspace metadata
  saveWorkspaceMeta(meta: WorkspaceMeta): void {
    if (!fs.existsSync(WORKSPACES_DIR)) {
      fs.mkdirSync(WORKSPACES_DIR, { recursive: true });
    }
    const file = path.join(WORKSPACES_DIR, `${meta.name}.json`);
    fs.writeFileSync(file, JSON.stringify(meta, null, 2));
  }

  loadWorkspaceMeta(name: string): WorkspaceMeta | null {
    try {
      const file = path.join(WORKSPACES_DIR, `${name}.json`);
      const data = fs.readFileSync(file, 'utf-8');
      const parsed = JSON.parse(data);
      if (isWorkspaceMeta(parsed)) {
        return parsed;
      }
      console.warn(`Invalid workspace metadata for: ${name}`);
      return null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('Failed to load workspace metadata:', error);
      }
      return null;
    }
  }

  listWorkspaces(): string[] {
    try {
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
    const file = path.join(WORKSPACES_DIR, `${name}.json`);
    try {
      fs.unlinkSync(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('Failed to delete workspace metadata:', error);
      }
    }
  }
}

// Singleton instance - lazily created
let apiClientInstance: APIClient | null = null;

export function getAPIClient(): APIClient {
  if (!apiClientInstance) {
    apiClientInstance = new APIClient();
  }
  return apiClientInstance;
}
