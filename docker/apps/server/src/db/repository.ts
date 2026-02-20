import { SqliteDB } from './database';
import { Sandbox, SandboxStatus, CreateSandboxRequest, AgentInfo } from '../types';

export class SandboxRepository {
  private db: SqliteDB;
  private tableName = 'sandboxes';

  constructor(db: SqliteDB) {
    this.db = db;
  }

  create(req: CreateSandboxRequest, metadata?: Record<string, unknown>): Sandbox {
    const id = `sbx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();

    const sandbox: Sandbox = {
      id,
      name: req.name,
      status: 'pending',
      image: req.image,
      host: req.host || 'localhost',
      port: 0,
      user: req.user || 'root',
      createdAt: now,
      expiresAt: req.expiresAt,
      metadata,
    };

    const stmt = this.db.getDatabase().prepare(`
      INSERT INTO ${this.tableName} (id, name, status, image, host, port, user, created_at, expires_at, metadata, agent_info, runner_id, container_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      sandbox.id,
      sandbox.status,
      sandbox.image,
      sandbox.host,
      sandbox.port,
      sandbox.user,
      sandbox.createdAt,
      sandbox.expiresAt || null,
      sandbox.metadata ? JSON.stringify(sandbox.metadata) : null,
      null,
      null,
      null
    );

    return sandbox;
  }

  getById(id: string): Sandbox | undefined {
    const stmt = this.db.getDatabase().prepare(`SELECT * FROM ${this.tableName} WHERE id = ?`);
    const row = stmt.get(id) as Record<string, unknown> | undefined;

    if (!row) return undefined;

    return this.rowToSandbox(row);
  }

  getAll(): Sandbox[] {
    const stmt = this.db.getDatabase().prepare(`SELECT * FROM ${this.tableName} ORDER BY created_at DESC`);
    const rows = stmt.all() as Record<string, unknown>[];

    return rows.map((row) => this.rowToSandbox(row));
  }

  getByStatus(status: SandboxStatus): Sandbox[] {
    const stmt = this.db.getDatabase().prepare(`SELECT * FROM ${this.tableName} WHERE status = ? ORDER BY created_at DESC`);
    const rows = stmt.all(status) as Record<string, unknown>[];

    return rows.map((row) => this.rowToSandbox(row));
  }

  update(id: string, updates: Partial<Sandbox>): Sandbox | undefined {
    const existing = this.getById(id);
    if (!existing) return undefined;

    const updatesStr = updates as Record<string, unknown>;
    const setClauses: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(updatesStr)) {
      if (key === 'metadata' || key === 'agentInfo') {
        setClauses.push(`${key} = ?`);
        values.push(value ? JSON.stringify(value) : null);
      } else if (key !== 'id') {
        setClauses.push(`${key} = ?`);
        values.push(value ?? null);
      }
    }

    if (setClauses.length === 0) return existing;

    values.push(id);

    const stmt = this.db.getDatabase().prepare(`
      UPDATE ${this.tableName}
      SET ${setClauses.join(', ')}
      WHERE id = ?
    `);

    stmt.run(...values);

    return this.getById(id);
  }

  updateRunnerStatus(
    id: string,
    status: { runnerId?: string; containerId?: string; port?: number; sandboxStatus?: SandboxStatus }
  ): Sandbox | undefined {
    const updates: Partial<Sandbox> = {};

    if (status.runnerId !== undefined) updates.runnerId = status.runnerId;
    if (status.containerId !== undefined) updates.containerId = status.containerId;
    if (status.port !== undefined) updates.port = status.port;
    if (status.sandboxStatus !== undefined) updates.status = status.sandboxStatus;

    return this.update(id, updates);
  }

  delete(id: string): boolean {
    const stmt = this.db.getDatabase().prepare(`DELETE FROM ${this.tableName} WHERE id = ?`);
    const result = stmt.run(id);

    return result.changes > 0;
  }

  private rowToSandbox(row: Record<string, unknown>): Sandbox {
    return {
      id: row.id as string,
      name: row.name as string,
      status: row.status as SandboxStatus,
      image: row.image as string,
      host: row.host as string,
      port: row.port as number,
      user: row.user as string,
      token: row.token as string | undefined,
      createdAt: row.created_at as string,
      expiresAt: row.expires_at as string | undefined,
      metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
      agentInfo: row.agent_info ? JSON.parse(row.agent_info as string) : undefined,
      runnerId: row.runner_id as string | undefined,
      containerId: row.container_id as string | undefined,
    };
  }
}

export class APIKeyRepository {
  private db: SqliteDB;
  private tableName = 'api_keys';

  constructor(db: SqliteDB) {
    this.db = db;
  }

  create(options: { name: string; expiresAt?: Date }): APIKey {
    const id = `key_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const key = `cpk_${Date.now()}_${Math.random().toString(36).substr(2, 24)}`;
    const now = new Date().toISOString();

    const apiKey: APIKey = {
      id,
      key,
      name: options.name,
      createdAt: now,
      expiresAt: options.expiresAt?.toISOString(),
    };

    const stmt = this.db.getDatabase().prepare(`
      INSERT INTO ${this.tableName} (id, key, name, created_at, expires_at, last_used_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(apiKey.id, apiKey.key, apiKey.name, apiKey.createdAt, apiKey.expiresAt || null, null);

    return apiKey;
  }

  getById(id: string): APIKey | undefined {
    const stmt = this.db.getDatabase().prepare(`SELECT * FROM ${this.tableName} WHERE id = ?`);
    const row = stmt.get(id) as Record<string, unknown> | undefined;

    if (!row) return undefined;

    return this.rowToAPIKey(row);
  }

  getByKey(key: string): APIKey | undefined {
    const stmt = this.db.getDatabase().prepare(`SELECT * FROM ${this.tableName} WHERE key = ?`);
    const row = stmt.get(key) as Record<string, unknown> | undefined;

    if (!row) return undefined;

    return this.rowToAPIKey(row);
  }

  getAll(): APIKey[] {
    const stmt = this.db.getDatabase().prepare(`SELECT * FROM ${this.tableName} ORDER BY created_at DESC`);
    const rows = stmt.all() as Record<string, unknown>[];

    return rows.map((row) => this.rowToAPIKey(row));
  }

  validate(key: string): APIKey | undefined {
    const apiKey = this.getByKey(key);
    if (!apiKey) return undefined;

    // Check expiration
    if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) {
      return undefined;
    }

    // Update last used
    const stmt = this.db.getDatabase().prepare(`
      UPDATE ${this.tableName} SET last_used_at = ? WHERE id = ?
    `);
    stmt.run(new Date().toISOString(), apiKey.id);

    return apiKey;
  }

  delete(id: string): boolean {
    const stmt = this.db.getDatabase().prepare(`DELETE FROM ${this.tableName} WHERE id = ?`);
    const result = stmt.run(id);

    return result.changes > 0;
  }

  private rowToAPIKey(row: Record<string, unknown>): APIKey {
    return {
      id: row.id as string,
      key: row.key as string,
      name: row.name as string,
      createdAt: row.created_at as string,
      expiresAt: row.expires_at as string | undefined,
      lastUsedAt: row.last_used_at as string | undefined,
    };
  }
}

export class AuditLogRepository {
  private db: SqliteDB;
  private tableName = 'audit_logs';

  constructor(db: SqliteDB) {
    this.db = db;
  }

  log(action: string, resource: string, resourceId?: string, userId?: string, details?: Record<string, unknown>): void {
    const id = `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = new Date().toISOString();

    const stmt = this.db.getDatabase().prepare(`
      INSERT INTO ${this.tableName} (id, action, resource, resource_id, user_id, details, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, action, resource, resourceId || null, userId || null, details ? JSON.stringify(details) : null, timestamp);
  }

  getAll(options?: { resource?: string; limit?: number }): AuditLog[] {
    let query = `SELECT * FROM ${this.tableName}`;
    const params: unknown[] = [];

    if (options?.resource) {
      query += ` WHERE resource = ?`;
      params.push(options.resource);
    }

    query += ` ORDER BY timestamp DESC`;

    if (options?.limit) {
      query += ` LIMIT ?`;
      params.push(options.limit);
    }

    const stmt = this.db.getDatabase().prepare(query);
    const rows = stmt.all(...params) as Record<string, unknown>[];

    return rows.map((row) => this.rowToAuditLog(row));
  }

  delete(id: string): boolean {
    const stmt = this.db.getDatabase().prepare(`DELETE FROM ${this.tableName} WHERE id = ?`);
    const result = stmt.run(id);

    return result.changes > 0;
  }

  private rowToAuditLog(row: Record<string, unknown>): AuditLog {
    return {
      id: row.id as string,
      action: row.action as string,
      resource: row.resource as string,
      resourceId: row.resource_id as string | undefined,
      userId: row.user_id as string | undefined,
      details: row.details ? JSON.parse(row.details as string) : undefined,
      timestamp: row.timestamp as string,
    };
  }
}

export class JobRepository {
  private db: SqliteDB;
  private tableName = 'jobs';

  constructor(db: SqliteDB) {
    this.db = db;
  }

  create(req: CreateJobRequest): Job {
    const id = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();

    const job: Job = {
      id,
      type: req.type,
      sandboxId: req.sandboxId,
      image: req.image,
      status: 'pending',
      createdAt: now,
      env: req.env,
      memory: req.memory,
      cpu: req.cpu,
      networkMode: req.networkMode,
    };

    const stmt = this.db.getDatabase().prepare(`
      INSERT INTO ${this.tableName} (id, type, sandbox_id, image, status, runner_id, created_at, env, memory, cpu, network_mode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(job.id, job.type, job.sandboxId, job.image, job.status, null, job.createdAt, job.env ? JSON.stringify(job.env) : null, job.memory || null, job.cpu || null, job.networkMode || null);

    return job;
  }

  getById(id: string): Job | undefined {
    const stmt = this.db.getDatabase().prepare(`SELECT * FROM ${this.tableName} WHERE id = ?`);
    const row = stmt.get(id) as Record<string, unknown> | undefined;

    if (!row) return undefined;

    return this.rowToJob(row);
  }

  getBySandboxId(sandboxId: string): Job[] {
    const stmt = this.db.getDatabase().prepare(`SELECT * FROM ${this.tableName} WHERE sandbox_id = ? ORDER BY created_at DESC`);
    const rows = stmt.all(sandboxId) as Record<string, unknown>[];

    return rows.map((row) => this.rowToJob(row));
  }

  getAll(): Job[] {
    const stmt = this.db.getDatabase().prepare(`SELECT * FROM ${this.tableName} ORDER BY created_at DESC`);
    const rows = stmt.all() as Record<string, unknown>[];

    return rows.map((row) => this.rowToJob(row));
  }

  getByStatus(status: string): Job[] {
    const stmt = this.db.getDatabase().prepare(`SELECT * FROM ${this.tableName} WHERE status = ? ORDER BY created_at DESC`);
    const rows = stmt.all(status) as Record<string, unknown>[];

    return rows.map((row) => this.rowToJob(row));
  }

  update(id: string, updates: Partial<Job>): Job | undefined {
    const existing = this.getById(id);
    if (!existing) return undefined;

    const updatesStr = updates as Record<string, unknown>;
    const setClauses: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(updatesStr)) {
      if (key === 'env') {
        setClauses.push(`${key} = ?`);
        values.push(value ? JSON.stringify(value) : null);
      } else if (key !== 'id') {
        setClauses.push(`${key} = ?`);
        values.push(value ?? null);
      }
    }

    if (setClauses.length === 0) return existing;

    values.push(id);

    const stmt = this.db.getDatabase().prepare(`
      UPDATE ${this.tableName}
      SET ${setClauses.join(', ')}
      WHERE id = ?
    `);

    stmt.run(...values);

    return this.getById(id);
  }

  assignToRunner(id: string, runnerId: string): Job | undefined {
    const stmt = this.db.getDatabase().prepare(`
      UPDATE ${this.tableName}
      SET runner_id = ?, status = 'running'
      WHERE id = ?
    `);

    stmt.run(runnerId, id);
    return this.getById(id);
  }

  delete(id: string): boolean {
    const stmt = this.db.getDatabase().prepare(`DELETE FROM ${this.tableName} WHERE id = ?`);
    const result = stmt.run(id);

    return result.changes > 0;
  }

  private rowToJob(row: Record<string, unknown>): Job {
    return {
      id: row.id as string,
      type: row.type as string,
      sandboxId: row.sandbox_id as string,
      image: row.image as string,
      status: row.status as Job['status'],
      runnerId: row.runner_id as string | undefined,
      createdAt: row.created_at as string,
      env: row.env ? JSON.parse(row.env as string) : undefined,
      memory: row.memory as string | undefined,
      cpu: row.cpu as number | undefined,
      networkMode: row.network_mode as string | undefined,
    };
  }
}
