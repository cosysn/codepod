/**
 * API Client - Thin wrapper around CodePod SDK
 * Re-exports SDK functionality with workspace metadata management
 */

import * as path from 'path';
import * as fs from 'fs';
import { CodePodClient, Sandbox, CreateVolumeRequest, CreateVolumeResponse } from '@codepod/sdk-ts';
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

// Lazy SDK client singleton
let sdkClient: CodePodClient | null = null;

function getSDKClient(): CodePodClient {
  if (!sdkClient) {
    const config = configManager.load();
    if (!config.endpoint) {
      throw new Error('API endpoint not configured. Run: devpod config set endpoint <url>');
    }
    const apiKey = process.env.CODEPOD_API_KEY;
    sdkClient = new CodePodClient({
      baseURL: config.endpoint,
      apiKey,
      timeout: 30000
    });
  }
  return sdkClient;
}

// Re-export from SDK
export { CodePodClient, Sandbox, CreateVolumeRequest, CreateVolumeResponse };
export type { CreateSandboxRequest } from '@codepod/sdk-ts';

/**
 * Create a sandbox and wrap in Sandbox class
 */
export async function createSandbox(
  req: Parameters<CodePodClient['createSandbox']>[0]
): Promise<Sandbox> {
  const client = getSDKClient();
  const response = await client.createSandbox(req);
  return new Sandbox(client, response.sandbox);
}

/**
 * Create a sandbox and wait for it to be running (E2B-style)
 */
export async function createSandboxAndWait(
  req: Parameters<CodePodClient['createSandbox']>[0],
  timeout: number = 120
): Promise<Sandbox> {
  const client = getSDKClient();
  return client.createSandboxAndWait(req, timeout);
}

/**
 * Get a sandbox by ID
 */
export async function getSandbox(id: string): Promise<Sandbox | null> {
  try {
    const client = getSDKClient();
    const sandbox = await client.getSandbox(id);
    return new Sandbox(client, sandbox);
  } catch {
    return null;
  }
}

/**
 * Delete a sandbox
 */
export async function deleteSandbox(id: string): Promise<void> {
  const client = getSDKClient();
  await client.deleteSandbox(id);
}

/**
 * Stop a sandbox
 */
export async function stopSandbox(id: string): Promise<void> {
  const client = getSDKClient();
  await client.stopSandbox(id);
}

/**
 * Start/restart a sandbox
 */
export async function startSandbox(id: string): Promise<void> {
  const client = getSDKClient();
  await client.restartSandbox(id);
}

/**
 * Get sandbox token
 */
export async function getSandboxToken(id: string): Promise<string> {
  const client = getSDKClient();
  const response = await client.getSandboxToken(id);
  return response.token;
}

/**
 * Create a volume
 */
export async function createVolume(req: CreateVolumeRequest): Promise<CreateVolumeResponse> {
  const client = getSDKClient();
  return client.createVolume(req);
}

/**
 * Delete a volume
 */
export async function deleteVolume(id: string): Promise<void> {
  const client = getSDKClient();
  await client.deleteVolume(id);
}

// ==================== Workspace Metadata ====================

export function saveWorkspaceMeta(meta: WorkspaceMeta): void {
  if (!fs.existsSync(WORKSPACES_DIR)) {
    fs.mkdirSync(WORKSPACES_DIR, { recursive: true });
  }
  const file = path.join(WORKSPACES_DIR, `${meta.name}.json`);
  fs.writeFileSync(file, JSON.stringify(meta, null, 2));
}

export function loadWorkspaceMeta(name: string): WorkspaceMeta | null {
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

export function listWorkspaces(): string[] {
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

export function deleteWorkspaceMeta(name: string): void {
  const file = path.join(WORKSPACES_DIR, `${name}.json`);
  try {
    fs.unlinkSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('Failed to delete workspace metadata:', error);
    }
  }
}
