import { getDatabase, SqliteDB } from './database';
import { SandboxRepository, APIKeyRepository, AuditLogRepository } from './repository';
import { Sandbox, SandboxStatus, APIKey, AuditLog, CreateSandboxRequest, AgentInfo } from '../types';

export class Store {
  private sandboxRepo: SandboxRepository;
  private apiKeyRepo: APIKeyRepository;
  private auditRepo: AuditLogRepository;
  private useSqlite: boolean;

  constructor(useSqlite = true) {
    this.useSqlite = useSqlite;
    if (useSqlite) {
      const db = getDatabase();
      this.sandboxRepo = new SandboxRepository(db);
      this.apiKeyRepo = new APIKeyRepository(db);
      this.auditRepo = new AuditLogRepository(db);
    }
  }

  // Sandbox operations
  createSandbox(req: CreateSandboxRequest, metadata?: Record<string, unknown>): Sandbox {
    if (this.useSqlite && this.sandboxRepo) {
      return this.sandboxRepo.create(req, metadata);
    }
    throw new Error('SQLite not enabled');
  }

  getSandbox(id: string): Sandbox | undefined {
    if (this.useSqlite && this.sandboxRepo) {
      return this.sandboxRepo.getById(id);
    }
    throw new Error('SQLite not enabled');
  }

  listSandboxes(): Sandbox[] {
    if (this.useSqlite && this.sandboxRepo) {
      return this.sandboxRepo.getAll();
    }
    throw new Error('SQLite not enabled');
  }

  updateSandbox(id: string, updates: Partial<Sandbox>): Sandbox | undefined {
    if (this.useSqlite && this.sandboxRepo) {
      return this.sandboxRepo.update(id, updates);
    }
    throw new Error('SQLite not enabled');
  }

  updateAgentInfo(id: string, info: Partial<AgentInfo>): Sandbox | undefined {
    if (!this.useSqlite || !this.sandboxRepo) {
      throw new Error('SQLite not enabled');
    }
    const sandbox = this.sandboxRepo.getById(id);
    if (!sandbox) return undefined;
    const agentInfo = { ...sandbox.agentInfo, ...info, lastHeartbeat: new Date().toISOString() };
    return this.sandboxRepo.update(id, { agentInfo } as Partial<Sandbox>);
  }

  updateSandboxRunnerStatus(
    id: string,
    status: { runnerId?: string; containerId?: string; port?: number; sandboxStatus?: SandboxStatus }
  ): Sandbox | undefined {
    if (this.useSqlite && this.sandboxRepo) {
      return this.sandboxRepo.updateRunnerStatus(id, status);
    }
    throw new Error('SQLite not enabled');
  }

  deleteSandbox(id: string): boolean {
    if (this.useSqlite && this.sandboxRepo) {
      return this.sandboxRepo.delete(id);
    }
    throw new Error('SQLite not enabled');
  }

  getSandboxesByStatus(status: SandboxStatus): Sandbox[] {
    if (this.useSqlite && this.sandboxRepo) {
      return this.sandboxRepo.getByStatus(status);
    }
    throw new Error('SQLite not enabled');
  }

  // API Key operations
  createAPIKey(options: { name: string; expiresAt?: Date }): APIKey {
    if (this.useSqlite && this.apiKeyRepo) {
      return this.apiKeyRepo.create(options);
    }
    throw new Error('SQLite not enabled');
  }

  validateAPIKey(key: string): APIKey | undefined {
    if (this.useSqlite && this.apiKeyRepo) {
      return this.apiKeyRepo.validate(key);
    }
    throw new Error('SQLite not enabled');
  }

  listAPIKeys(): APIKey[] {
    if (this.useSqlite && this.apiKeyRepo) {
      return this.apiKeyRepo.getAll();
    }
    throw new Error('SQLite not enabled');
  }

  deleteAPIKey(id: string): boolean {
    if (this.useSqlite && this.apiKeyRepo) {
      return this.apiKeyRepo.delete(id);
    }
    throw new Error('SQLite not enabled');
  }

  revokeAPIKey(key: string): boolean {
    if (this.useSqlite && this.apiKeyRepo) {
      const apiKey = this.apiKeyRepo.getByKey(key);
      if (apiKey) {
        return this.apiKeyRepo.delete(apiKey.id);
      }
      return false;
    }
    throw new Error('SQLite not enabled');
  }

  // Audit log operations
  log(action: string, resource: string, resourceId?: string, userId?: string, details?: Record<string, unknown>): void {
    if (this.useSqlite && this.auditRepo) {
      this.auditRepo.log(action, resource, resourceId, userId, details);
    } else {
      throw new Error('SQLite not enabled');
    }
  }

  getAuditLogs(options?: { resource?: string; limit?: number }): AuditLog[] {
    if (this.useSqlite && this.auditRepo) {
      return this.auditRepo.getAll(options);
    }
    throw new Error('SQLite not enabled');
  }

  // Stats
  getStats(): any {
    if (!this.useSqlite || !this.sandboxRepo) {
      throw new Error('SQLite not enabled');
    }
    const sandboxes = this.sandboxRepo.getAll();
    return {
      totalSandboxes: sandboxes.length,
      runningSandboxes: sandboxes.filter((s) => s.status === 'running').length,
      stoppedSandboxes: sandboxes.filter((s) => s.status === 'stopped' || s.status === 'deleted').length,
      totalAPIKeys: this.apiKeyRepo?.getAll().length || 0,
      totalAuditLogs: this.auditRepo?.getAll().length || 0,
    };
  }

  // Reset for testing
  reset(): void {
    this.useSqlite = false;
  }
}

// Create singleton with SQLite enabled by default
export const store = new Store(true);
