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
      return JSON.parse(data);
    } catch {
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
    } catch {
      // Ignore if file doesn't exist
    }
  }
}

export const apiClient = new APIClient();
