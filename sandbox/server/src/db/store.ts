/**
 * In-memory database store
 */

import {
  Sandbox,
  SandboxStatus,
  APIKey,
  AuditLog,
  CreateSandboxRequest,
  AgentInfo,
  Volume,
  VolumeStatus,
  CreateVolumeRequest,
} from '../types';

// Simple UUID generator (browser/node compatible)
function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export class Store {
  private sandboxes: Map<string, Sandbox> = new Map();
  private apiKeys: Map<string, APIKey> = new Map();
  private auditLogs: AuditLog[] = [];
  private sandboxesCounter: number = 0;
  private volumes: Map<string, Volume> = new Map();
  private volumesCounter: number = 0;

  constructor() {
    // Initialize with a default API key for testing
    this.createAPIKey({
      name: 'default',
      expiresAt: undefined,
    });
  }

  // Sandbox operations
  createSandbox(req: CreateSandboxRequest, metadata?: Record<string, unknown>): Sandbox {
    const id = `sbox-${++this.sandboxesCounter}-${generateId().slice(0, 8)}`;
    const now = new Date();

    const sandbox: Sandbox = {
      id,
      name: req.name || `sandbox-${id.slice(0, 8)}`,
      status: 'pending',
      image: req.image,
      host: 'localhost',
      port: 0, // Will be assigned by Runner
      user: 'root',
      token: generateId().slice(0, 32),
      createdAt: now,
      expiresAt: req.timeout ? new Date(now.getTime() + req.timeout * 1000) : undefined,
      metadata,
    };

    this.sandboxes.set(id, sandbox);
    this.log('CREATE', 'sandbox', id, undefined, { image: req.image, name: sandbox.name });

    return sandbox;
  }

  getSandbox(id: string): Sandbox | undefined {
    return this.sandboxes.get(id);
  }

  listSandboxes(): Sandbox[] {
    return Array.from(this.sandboxes.values());
  }

  updateSandbox(id: string, updates: Partial<Sandbox>): Sandbox | undefined {
    const sandbox = this.sandboxes.get(id);
    if (!sandbox) return undefined;

    const updated = { ...sandbox, ...updates };
    this.sandboxes.set(id, updated);
    return updated;
  }

  updateAgentInfo(id: string, info: Partial<AgentInfo>): Sandbox | undefined {
    const sandbox = this.sandboxes.get(id);
    if (!sandbox) return undefined;

    sandbox.agentInfo = {
      ...sandbox.agentInfo,
      ...info,
      lastHeartbeat: new Date().toISOString(),
    };
    this.sandboxes.set(id, sandbox);
    return sandbox;
  }

  // UpdateAgentAddress updates the agent gRPC address
  updateAgentAddress(id: string, address: { host?: string; port?: number; token?: string }): Sandbox | undefined {
    const sandbox = this.sandboxes.get(id);
    if (!sandbox) return undefined;

    if (!sandbox.agentInfo) {
      sandbox.agentInfo = {
        lastHeartbeat: new Date().toISOString(),
      };
    }

    if (address.host) {
      sandbox.agentInfo.addressHost = address.host;
    }
    if (address.port) {
      sandbox.agentInfo.addressPort = address.port;
    }
    if (address.token) {
      sandbox.agentInfo.addressToken = address.token;
    }
    // Build combined address string
    if (sandbox.agentInfo.addressHost && sandbox.agentInfo.addressPort) {
      sandbox.agentInfo.address = `${sandbox.agentInfo.addressHost}:${sandbox.agentInfo.addressPort}`;
    }

    this.sandboxes.set(id, sandbox);
    return sandbox;
  }

  updateSandboxRunnerStatus(
    id: string,
    status: {
      runnerId?: string;
      containerId?: string;
      port?: number;
      host?: string;
      sandboxStatus?: SandboxStatus;
    }
  ): Sandbox | undefined {
    const sandbox = this.sandboxes.get(id);
    if (!sandbox) return undefined;

    const updated = { ...sandbox };
    if (status.runnerId) {
      updated.runnerId = status.runnerId;
    }
    if (status.containerId) {
      updated.containerId = status.containerId;
    }
    if (status.port) {
      updated.port = status.port;
    }
    if (status.host) {
      updated.host = status.host;
    }
    if (status.sandboxStatus) {
      updated.status = status.sandboxStatus;
    }

    this.sandboxes.set(id, updated);
    return updated;
  }

  deleteSandbox(id: string): boolean {
    const deleted = this.sandboxes.delete(id);
    if (deleted) {
      this.log('DELETE', 'sandbox', id);
    }
    return deleted;
  }

  getSandboxesByStatus(status: SandboxStatus): Sandbox[] {
    return Array.from(this.sandboxes.values()).filter((s) => s.status === status);
  }

  // API Key operations
  createAPIKey(options: { name: string; expiresAt?: Date }): APIKey {
    const id = generateId();
    const key = `cp_${generateId().replace(/-/g, '').slice(0, 32)}`;

    const apiKey: APIKey = {
      id,
      key,
      name: options.name,
      createdAt: new Date(),
      expiresAt: options.expiresAt,
    };

    this.apiKeys.set(key, apiKey);
    this.log('CREATE', 'api_key', id, undefined, { name: options.name });

    return apiKey;
  }

  validateAPIKey(key: string): APIKey | undefined {
    const apiKey = this.apiKeys.get(key);
    if (!apiKey) return undefined;

    // Check expiration
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      return undefined;
    }

    // Update last used
    apiKey.lastUsedAt = new Date();
    return apiKey;
  }

  listAPIKeys(): APIKey[] {
    return Array.from(this.apiKeys.values());
  }

  deleteAPIKey(id: string): boolean {
    // Find key by id
    for (const [key, apiKey] of this.apiKeys.entries()) {
      if (apiKey.id === id) {
        this.apiKeys.delete(key);
        this.log('DELETE', 'api_key', id);
        return true;
      }
    }
    return false;
  }

  revokeAPIKey(key: string): boolean {
    const deleted = this.apiKeys.delete(key);
    if (deleted) {
      this.log('REVOKE', 'api_key', undefined, undefined, { keyPrefix: key.slice(0, 8) });
    }
    return deleted;
  }

  // Audit log operations
  log(
    action: string,
    resource: string,
    resourceId?: string,
    userId?: string,
    details?: Record<string, unknown>
  ): void {
    this.auditLogs.push({
      id: generateId(),
      action,
      resource,
      resourceId,
      userId,
      details,
      timestamp: new Date(),
    });
  }

  getAuditLogs(options?: { resource?: string; limit?: number }): AuditLog[] {
    let logs = this.auditLogs;

    if (options?.resource) {
      logs = logs.filter((l) => l.resource === options.resource);
    }

    logs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    if (options?.limit) {
      logs = logs.slice(0, options.limit);
    }

    return logs;
  }

  // Stats
  getStats(): {
    totalSandboxes: number;
    runningSandboxes: number;
    stoppedSandboxes: number;
    totalAPIKeys: number;
    totalAuditLogs: number;
  } {
    const sandboxes = Array.from(this.sandboxes.values());

    return {
      totalSandboxes: sandboxes.length,
      runningSandboxes: sandboxes.filter((s) => s.status === 'running').length,
      stoppedSandboxes: sandboxes.filter((s) => s.status === 'stopped' || s.status === 'deleted').length,
      totalAPIKeys: this.apiKeys.size,
      totalAuditLogs: this.auditLogs.length,
    };
  }

  // Reset for testing
  reset(): void {
    this.sandboxes.clear();
    this.apiKeys.clear();
    this.auditLogs = [];
    this.sandboxesCounter = 0;
    this.volumes.clear();
    this.volumesCounter = 0;
  }

  // Volume operations
  createVolume(req: CreateVolumeRequest): Volume {
    const id = `vol-${++this.volumesCounter}-${generateId().slice(0, 8)}`;
    const now = new Date();

    const volume: Volume = {
      id,
      name: req.name || `volume-${id.slice(0, 8)}`,
      status: 'available',
      size: req.size || '10Gi',
      createdAt: now,
    };

    this.volumes.set(id, volume);
    this.log('CREATE', 'volume', id, undefined, { name: volume.name, size: volume.size });

    return volume;
  }

  getVolume(id: string): Volume | undefined {
    return this.volumes.get(id);
  }

  listVolumes(): Volume[] {
    return Array.from(this.volumes.values());
  }

  deleteVolume(id: string): boolean {
    const volume = this.volumes.get(id);
    if (!volume) return false;

    if (volume.status === 'in-use') {
      // Mark as deleting instead of immediately deleting
      volume.status = 'deleting';
      this.volumes.set(id, volume);
      this.log('UPDATE', 'volume', id, undefined, { status: 'deleting' });
      return true;
    }

    const deleted = this.volumes.delete(id);
    if (deleted) {
      this.log('DELETE', 'volume', id);
    }
    return deleted;
  }

  updateVolumeHostPath(id: string, hostPath: string): Volume | undefined {
    const volume = this.volumes.get(id);
    if (!volume) return undefined;

    volume.hostPath = hostPath;
    this.volumes.set(id, volume);
    return volume;
  }
}

export const store = new Store();
