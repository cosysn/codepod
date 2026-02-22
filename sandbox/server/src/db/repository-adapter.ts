/**
 * Repository adapter - provides store-compatible interface using SQLite repositories
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
import {
  SandboxRepository,
  APIKeyRepository,
  AuditLogRepository,
} from './repository';
import { initDatabase, getDatabase } from './database';
import * as path from 'path';
import * as fs from 'fs';

// Ensure data directory exists
const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize database with file storage
const dbPath = process.env.CODEPOD_DB_PATH || path.join(dataDir, 'codepod.db');
initDatabase(dbPath);

// Simple UUID generator
function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Repository adapter providing store-compatible interface
 */
export class RepositoryAdapter {
  sandboxRepo: SandboxRepository;
  apiKeyRepo: APIKeyRepository;
  auditLogRepo: AuditLogRepository;

  // In-memory volume storage (not yet migrated to SQLite)
  private volumes: Map<string, Volume> = new Map();
  private volumesCounter: number = 0;

  constructor() {
    this.sandboxRepo = new SandboxRepository();
    this.apiKeyRepo = new APIKeyRepository();
    this.auditLogRepo = new AuditLogRepository();

    // Initialize with a default API key for testing
    this.initializeDefaultAPIKey();
  }

  private initializeDefaultAPIKey(): void {
    const keys = this.apiKeyRepo.getAll();
    if (keys.length === 0) {
      this.apiKeyRepo.create({
        name: 'default',
        expiresAt: undefined,
      });
    }
  }

  // Sandbox operations - compatible with store interface
  createSandbox(req: CreateSandboxRequest, metadata?: Record<string, unknown>): Sandbox {
    return this.sandboxRepo.create(req, metadata);
  }

  getSandbox(id: string): Sandbox | undefined {
    return this.sandboxRepo.getById(id);
  }

  listSandboxes(): Sandbox[] {
    return this.sandboxRepo.getAll();
  }

  updateSandbox(id: string, updates: Partial<Sandbox>): Sandbox | undefined {
    return this.sandboxRepo.update(id, updates);
  }

  updateAgentInfo(id: string, info: Partial<AgentInfo>): Sandbox | undefined {
    const sandbox = this.sandboxRepo.getById(id);
    if (!sandbox) return undefined;

    const updated: Sandbox = {
      ...sandbox,
      agentInfo: {
        ...sandbox.agentInfo,
        ...info,
        lastHeartbeat: new Date().toISOString(),
      },
    };

    return this.sandboxRepo.update(id, updated);
  }

  updateAgentAddress(id: string, address: { host?: string; port?: number; token?: string }): Sandbox | undefined {
    const sandbox = this.sandboxRepo.getById(id);
    if (!sandbox) return undefined;

    const agentInfo: AgentInfo = {
      ...sandbox.agentInfo,
      lastHeartbeat: sandbox.agentInfo?.lastHeartbeat || new Date().toISOString(),
    };

    if (address.host) {
      agentInfo.addressHost = address.host;
    }
    if (address.port) {
      agentInfo.addressPort = address.port;
    }
    if (address.token) {
      agentInfo.addressToken = address.token;
    }
    // Build combined address string
    if (agentInfo.addressHost && agentInfo.addressPort) {
      agentInfo.address = `${agentInfo.addressHost}:${agentInfo.addressPort}`;
    }

    return this.sandboxRepo.update(id, { agentInfo } as Partial<Sandbox>);
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
    return this.sandboxRepo.updateRunnerStatus(id, status);
  }

  deleteSandbox(id: string): boolean {
    const result = this.sandboxRepo.delete(id);
    if (result) {
      this.log('DELETE', 'sandbox', id);
    }
    return result;
  }

  getSandboxesByStatus(status: SandboxStatus): Sandbox[] {
    return this.sandboxRepo.getByStatus(status);
  }

  // API Key operations - compatible with store interface
  createAPIKey(options: { name: string; expiresAt?: Date }): APIKey {
    const apiKey = this.apiKeyRepo.create(options);
    this.log('CREATE', 'api_key', apiKey.id, undefined, { name: options.name });
    return apiKey;
  }

  validateAPIKey(key: string): APIKey | undefined {
    return this.apiKeyRepo.validate(key);
  }

  listAPIKeys(): APIKey[] {
    return this.apiKeyRepo.getAll();
  }

  deleteAPIKey(id: string): boolean {
    const result = this.apiKeyRepo.delete(id);
    if (result) {
      this.log('DELETE', 'api_key', id);
    }
    return result;
  }

  revokeAPIKey(key: string): boolean {
    // Find by key and delete
    const apiKey = this.apiKeyRepo.getByKey(key);
    if (apiKey) {
      const result = this.apiKeyRepo.delete(apiKey.id);
      if (result) {
        this.log('REVOKE', 'api_key', undefined, undefined, { keyPrefix: key.slice(0, 8) });
      }
      return result;
    }
    return false;
  }

  // Audit log operations - compatible with store interface
  log(
    action: string,
    resource: string,
    resourceId?: string,
    userId?: string,
    details?: Record<string, unknown>
  ): void {
    this.auditLogRepo.log(action, resource, resourceId, userId, details);
  }

  getAuditLogs(options?: { resource?: string; limit?: number }): AuditLog[] {
    return this.auditLogRepo.getAll(options);
  }

  // Stats
  getStats(): {
    totalSandboxes: number;
    runningSandboxes: number;
    stoppedSandboxes: number;
    totalAPIKeys: number;
    totalAuditLogs: number;
  } {
    const sandboxes = this.sandboxRepo.getAll();
    const apiKeys = this.apiKeyRepo.getAll();
    const auditLogs = this.auditLogRepo.getAll();

    return {
      totalSandboxes: sandboxes.length,
      runningSandboxes: sandboxes.filter((s) => s.status === 'running').length,
      stoppedSandboxes: sandboxes.filter((s) => s.status === 'stopped' || s.status === 'deleted').length,
      totalAPIKeys: apiKeys.length,
      totalAuditLogs: auditLogs.length,
    };
  }

  // Reset for testing
  reset(): void {
    // Note: In a real implementation, we would clear the database tables
    // For now, we just reset the in-memory volumes
    this.volumes.clear();
    this.volumesCounter = 0;
  }

  // Volume operations (still in-memory for now)
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

// Singleton instance
export const repository = new RepositoryAdapter();
