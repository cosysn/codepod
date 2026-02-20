import axios, { AxiosInstance } from 'axios';
import * as path from 'path';
import * as fs from 'fs';
import { configManager } from '../config';
import {
  Sandbox,
  Volume,
  CreateSandboxRequest,
  CreateVolumeRequest,
  WorkspaceMeta
} from '../types';

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
  private client: AxiosInstance;

  constructor(endpoint?: string) {
    const config = configManager.load();
    const baseURL = endpoint || config.endpoint;

    if (!baseURL) {
      throw new Error('API endpoint not configured. Run: devpod config set endpoint <url>');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    // Add API key if configured
    const apiKey = process.env.CODEPOD_API_KEY;
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    this.client = axios.create({
      baseURL,
      headers,
      timeout: 30000
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

export const apiClient = new APIClient();
