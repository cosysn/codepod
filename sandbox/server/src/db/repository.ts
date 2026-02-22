import { SqliteDB } from './database';
import { Sandbox, SandboxStatus, APIKey, AuditLog, CreateSandboxRequest } from '../types';

export class SandboxRepository {
  private db: SqliteDB;

  constructor(db?: SqliteDB) {
    this.db = db || require('./database').getDatabase();
  }

  create(req: CreateSandboxRequest, metadata?: Record<string, unknown>): Sandbox {
    const database = this.db.getDatabase();
    const id = `sbox-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const now = new Date().toISOString();

    const stmt = database.prepare(`
      INSERT INTO sandboxes (id, name, status, image, host, port, user, token, created_at, expires_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      req.name || `sandbox-${id.slice(0, 8)}`,
      'pending',
      req.image,
      'localhost',
      0,
      'root',
      Math.random().toString(36).slice(2, 34),
      now,
      req.timeout ? new Date(Date.now() + req.timeout * 1000).toISOString() : null,
      metadata ? JSON.stringify(metadata) : null
    );

    return this.getById(id)!;
  }

  getById(id: string): Sandbox | undefined {
    const database = this.db.getDatabase();
    const stmt = database.prepare('SELECT * FROM sandboxes WHERE id = ?');
    const row = stmt.get(id);
    return row ? this.mapToSandbox(row) : undefined;
  }

  getAll(): Sandbox[] {
    const database = this.db.getDatabase();
    const stmt = database.prepare('SELECT * FROM sandboxes ORDER BY created_at DESC');
    return stmt.all().map((row: any) => this.mapToSandbox(row));
  }

  update(id: string, updates: Partial<Sandbox>): Sandbox | undefined {
    const database = this.db.getDatabase();
    const sandbox = this.getById(id);
    if (!sandbox) return undefined;

    const fields: string[] = [];
    const values: any[] = [];

    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.port !== undefined) {
      fields.push('port = ?');
      values.push(updates.port);
    }
    if (updates.runnerId !== undefined) {
      fields.push('runner_id = ?');
      values.push(updates.runnerId);
    }
    if (updates.containerId !== undefined) {
      fields.push('container_id = ?');
      values.push(updates.containerId);
    }
    if (updates.token !== undefined) {
      fields.push('token = ?');
      values.push(updates.token);
    }
    if (updates.agentInfo !== undefined) {
      fields.push('agent_info = ?');
      values.push(JSON.stringify(updates.agentInfo));
    }

    if (fields.length === 0) return sandbox;

    values.push(id);
    const stmt = database.prepare(`UPDATE sandboxes SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values);

    return this.getById(id);
  }

  updateStatus(id: string, status: SandboxStatus): Sandbox | undefined {
    return this.update(id, { status } as Partial<Sandbox>);
  }

  updateRunnerStatus(
    id: string,
    status: { runnerId?: string; containerId?: string; port?: number; host?: string; sandboxStatus?: SandboxStatus }
  ): Sandbox | undefined {
    const updates: Partial<Sandbox> = {};
    if (status.runnerId) updates.runnerId = status.runnerId;
    if (status.containerId) updates.containerId = status.containerId;
    if (status.port) updates.port = status.port;
    if (status.host) updates.host = status.host;
    if (status.sandboxStatus) updates.status = status.sandboxStatus;
    return this.update(id, updates);
  }

  delete(id: string): boolean {
    const database = this.db.getDatabase();
    const stmt = database.prepare('DELETE FROM sandboxes WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  getByStatus(status: SandboxStatus): Sandbox[] {
    const database = this.db.getDatabase();
    const stmt = database.prepare('SELECT * FROM sandboxes WHERE status = ?');
    return stmt.all(status).map((row: any) => this.mapToSandbox(row));
  }

  private mapToSandbox(row: any): Sandbox {
    return {
      id: row.id,
      name: row.name,
      status: row.status as SandboxStatus,
      image: row.image,
      host: row.host,
      port: row.port,
      user: row.user,
      token: row.token,
      createdAt: new Date(row.created_at),
      expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      agentInfo: row.agent_info ? JSON.parse(row.agent_info) : undefined,
      runnerId: row.runner_id || undefined,
      containerId: row.container_id || undefined,
    };
  }
}

export interface JobData {
  id: string;
  type: string;
  sandboxId: string;
  image: string;
  token: string;
  status: string;
  runnerId?: string;
  createdAt: string;
  env?: Record<string, string>;
  memory?: string;
  cpu?: number;
  networkMode?: string;
}

export class JobRepository {
  private db: SqliteDB;

  constructor(db?: SqliteDB) {
    this.db = db || require('./database').getDatabase();
  }

  create(data: Omit<JobData, 'id' | 'status' | 'createdAt'>): JobData {
    const database = this.db.getDatabase();
    const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const now = new Date().toISOString();

    const stmt = database.prepare(`
      INSERT INTO jobs (id, type, sandbox_id, image, token, status, runner_id, created_at, env, memory, cpu, network_mode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      data.type,
      data.sandboxId,
      data.image,
      data.token || null,
      'pending',
      null,
      now,
      data.env ? JSON.stringify(data.env) : null,
      data.memory || null,
      data.cpu || null,
      data.networkMode || null
    );

    return this.getById(id)!;
  }

  getById(id: string): JobData | undefined {
    const database = this.db.getDatabase();
    const stmt = database.prepare('SELECT * FROM jobs WHERE id = ?');
    const row = stmt.get(id);
    return row ? this.mapToJob(row) : undefined;
  }

  getAll(): JobData[] {
    const database = this.db.getDatabase();
    const stmt = database.prepare('SELECT * FROM jobs ORDER BY created_at DESC');
    return stmt.all().map((row: any) => this.mapToJob(row));
  }

  getPending(runnerId?: string): JobData[] {
    const database = this.db.getDatabase();
    if (runnerId) {
      const stmt = database.prepare(`
        SELECT * FROM jobs
        WHERE (status = 'pending' AND runner_id IS NULL)
           OR (status = 'running' AND runner_id = ?)
        ORDER BY created_at ASC
      `);
      return stmt.all(runnerId).map((row: any) => this.mapToJob(row));
    }
    const stmt = database.prepare("SELECT * FROM jobs WHERE status = 'pending' ORDER BY created_at ASC");
    return stmt.all().map((row: any) => this.mapToJob(row));
  }

  updateStatus(id: string, status: string, runnerId?: string): boolean {
    const database = this.db.getDatabase();
    if (runnerId) {
      const stmt = database.prepare('UPDATE jobs SET status = ?, runner_id = ? WHERE id = ?');
      const result = stmt.run(status, runnerId, id);
      return result.changes > 0;
    }
    const stmt = database.prepare('UPDATE jobs SET status = ? WHERE id = ?');
    const result = stmt.run(status, id);
    return result.changes > 0;
  }

  assign(id: string, runnerId: string): boolean {
    return this.updateStatus(id, 'running', runnerId);
  }

  complete(id: string, success: boolean): boolean {
    return this.updateStatus(id, success ? 'completed' : 'failed');
  }

  private mapToJob(row: any): JobData {
    return {
      id: row.id,
      type: row.type,
      sandboxId: row.sandbox_id,
      image: row.image,
      token: row.token || '',
      status: row.status,
      runnerId: row.runner_id || undefined,
      createdAt: row.created_at,
      env: row.env ? JSON.parse(row.env) : undefined,
      memory: row.memory || undefined,
      cpu: row.cpu || undefined,
      networkMode: row.network_mode || undefined,
    };
  }
}

export class APIKeyRepository {
  private db: SqliteDB;

  constructor(db?: SqliteDB) {
    this.db = db || require('./database').getDatabase();
  }

  create(options: { name: string; expiresAt?: Date }): APIKey {
    const database = this.db.getDatabase();
    const id = Math.random().toString(36).slice(2);
    const key = `cp_${Math.random().toString(36).replace(/-/g, '').slice(0, 32)}`;
    const now = new Date().toISOString();

    const stmt = database.prepare(`
      INSERT INTO api_keys (id, key, name, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(id, key, options.name, now, options.expiresAt?.toISOString() || null);

    return this.getById(id)!;
  }

  getById(id: string): APIKey | undefined {
    const database = this.db.getDatabase();
    const stmt = database.prepare('SELECT * FROM api_keys WHERE id = ?');
    const row = stmt.get(id) as any;
    if (!row) return undefined;
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      createdAt: new Date(row.created_at),
      expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : undefined,
    };
  }

  getByKey(key: string): APIKey | undefined {
    const database = this.db.getDatabase();
    const stmt = database.prepare('SELECT * FROM api_keys WHERE key = ?');
    const row = stmt.get(key) as any;
    if (!row) return undefined;
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      createdAt: new Date(row.created_at),
      expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : undefined,
    };
  }

  validate(key: string): APIKey | undefined {
    const apiKey = this.getByKey(key);
    if (!apiKey) return undefined;
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) return undefined;
    return apiKey;
  }

  updateLastUsed(id: string): void {
    const database = this.db.getDatabase();
    const stmt = database.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?');
    stmt.run(new Date().toISOString(), id);
  }

  getAll(): APIKey[] {
    const database = this.db.getDatabase();
    const stmt = database.prepare('SELECT * FROM api_keys');
    return stmt.all().map((row: any) => ({
      id: row.id,
      key: row.key,
      name: row.name,
      createdAt: new Date(row.created_at),
      expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : undefined,
    }));
  }

  delete(id: string): boolean {
    const database = this.db.getDatabase();
    const stmt = database.prepare('DELETE FROM api_keys WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }
}

export class AuditLogRepository {
  private db: SqliteDB;

  constructor(db?: SqliteDB) {
    this.db = db || require('./database').getDatabase();
  }

  log(action: string, resource: string, resourceId?: string, userId?: string, details?: Record<string, unknown>): void {
    const database = this.db.getDatabase();
    const id = Math.random().toString(36).slice(2);
    const stmt = database.prepare(`
      INSERT INTO audit_logs (id, action, resource, resource_id, user_id, details, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, action, resource, resourceId, userId, details ? JSON.stringify(details) : null, new Date().toISOString());
  }

  getAll(options?: { resource?: string; limit?: number }): AuditLog[] {
    const database = this.db.getDatabase();
    let rows: any[];
    if (options?.resource) {
      const stmt = database.prepare('SELECT * FROM audit_logs WHERE resource = ? ORDER BY timestamp DESC LIMIT ?');
      rows = stmt.all(options.resource, options.limit || 100);
    } else {
      const stmt = database.prepare('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT ?');
      rows = stmt.all(options?.limit || 100);
    }
    return rows.map((row: any) => ({
      id: row.id,
      action: row.action,
      resource: row.resource,
      resourceId: row.resource_id || undefined,
      userId: row.user_id || undefined,
      details: row.details ? JSON.parse(row.details) : undefined,
      timestamp: new Date(row.timestamp),
    }));
  }
}
