# Server SQLite Persistence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add SQLite persistence to Server so that sandboxes, jobs, API keys, and audit logs survive server restarts.

**Architecture:** Use `better-sqlite3` for SQLite database. Create a db module that handles initialization, migrations, and provides a wrapper around SQLite operations. The Store class and Job service will use SQLite instead of in-memory Maps.

**Tech Stack:**
- `better-sqlite3`: Fast SQLite3 binding for Node.js
- `better-sqlite3-multiple-ci`: Multiple query support
- Existing in-memory APIs preserved for backward compatibility

---

## Task 1: Add SQLite Dependencies

**Files:**
- Modify: `apps/server/package.json`

**Step 1: Add dependencies**

```json
{
  "dependencies": {
    "better-sqlite3": "^9.4.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.8"
  }
}
```

**Step 2: Install dependencies**

Run: `cd apps/server && npm install`

**Step 3: Verify installation**

Run: `npm list better-sqlite3`
Expected: `better-sqlite3@^9.4.0` in dependencies

---

## Task 2: Create Database Module

**Files:**
- Create: `apps/server/src/db/database.ts`

**Step 1: Write the failing test**

```typescript
// apps/server/src/db/database.test.ts
import { Database } from './database';

describe('Database', () => {
  it('should create database instance', () => {
    const db = new Database(':memory:');
    expect(db).toBeDefined();
    db.close();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/server && npm test -- src/db/database.test.ts`
Expected: FAIL (file/directory does not exist)

**Step 3: Implement database module**

```typescript
// apps/server/src/db/database.ts
import Database from 'better-sqlite3';
import path from 'path';

export class SqliteDB {
  private db: Database.Database;
  private dataDir: string;

  constructor(dataDir?: string) {
    this.dataDir = dataDir || process.env.DATA_DIR || './data';
    this.db = new Database(path.join(this.dataDir, 'codepod.db'));
    this.db.pragma('journal_mode = WAL');
    this.initTables();
  }

  private initTables(): void {
    // Sandboxes table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sandboxes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        image TEXT NOT NULL,
        host TEXT DEFAULT 'localhost',
        port INTEGER DEFAULT 0,
        user TEXT DEFAULT 'root',
        token TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT,
        metadata TEXT,
        agent_info TEXT,
        runner_id TEXT,
        container_id TEXT
      )
    `);

    // API keys table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT,
        last_used_at TEXT
      )
    `);

    // Audit logs table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        resource TEXT NOT NULL,
        resource_id TEXT,
        user_id TEXT,
        details TEXT,
        timestamp TEXT NOT NULL
      )
    `);

    // Jobs table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        sandbox_id TEXT NOT NULL,
        image TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        runner_id TEXT,
        created_at TEXT NOT NULL,
        env TEXT,
        memory TEXT,
        cpu INTEGER,
        network_mode TEXT
      )
    `);

    // Indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sandboxes_status ON sandboxes(status);
      CREATE INDEX IF NOT EXISTS idx_sandboxes_runner_id ON sandboxes(runner_id);
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
      CREATE INDEX IF NOT EXISTS idx_jobs_runner_id ON jobs(runner_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource);
    `);
  }

  getDatabase(): Database.Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }

  // Transaction support
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}

// Singleton instance
let dbInstance: SqliteDB | null = null;

export function getDatabase(dataDir?: string): SqliteDB {
  if (!dbInstance) {
    dbInstance = new SqliteDB(dataDir);
  }
  return dbInstance;
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/server && npm test -- src/db/database.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/server/src/db/database.ts apps/server/src/db/database.test.ts apps/server/package.json
git commit -m "feat: add SQLite database module"
```

---

## Task 3: Create Repository Classes

**Files:**
- Create: `apps/server/src/db/repository.ts`

**Step 1: Write the failing test**

```typescript
// apps/server/src/db/repository.test.ts
import { SandboxRepository } from './repository';

describe('SandboxRepository', () => {
  it('should create repository instance', () => {
    const repo = new SandboxRepository();
    expect(repo).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/server && npm test -- src/db/repository.test.ts`
Expected: FAIL

**Step 3: Implement repository classes**

```typescript
// apps/server/src/db/repository.ts
import { getDatabase, SqliteDB } from './database';
import { Sandbox, SandboxStatus, APIKey, AuditLog, CreateSandboxRequest, AgentInfo } from '../types';

export class SandboxRepository {
  private db: SqliteDB;

  constructor(db?: SqliteDB) {
    this.db = db || getDatabase();
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
    status: { runnerId?: string; containerId?: string; port?: number; sandboxStatus?: SandboxStatus }
  ): Sandbox | undefined {
    const database = this.db.getDatabase();
    const sandbox = this.getById(id);
    if (!sandbox) return undefined;

    const updates: Partial<Sandbox> = {};
    if (status.runnerId) updates.runnerId = status.runnerId;
    if (status.containerId) updates.containerId = status.containerId;
    if (status.port) updates.port = status.port;
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

export class JobRepository {
  private db: SqliteDB;

  constructor(db?: SqliteDB) {
    this.db = db || getDatabase();
  }

  create(data: Omit<any, 'id' | 'status' | 'createdAt'>): any {
    const database = this.db.getDatabase();
    const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const now = new Date().toISOString();

    const stmt = database.prepare(`
      INSERT INTO jobs (id, type, sandbox_id, image, status, runner_id, created_at, env, memory, cpu, network_mode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      data.type,
      data.sandboxId,
      data.image,
      'pending',
      null,
      now,
      data.env ? JSON.stringify(data.env) : null,
      data.memory || null,
      data.cpu || null,
      data.networkMode || null
    );

    return this.getById(id);
  }

  getById(id: string): any | undefined {
    const database = this.db.getDatabase();
    const stmt = database.prepare('SELECT * FROM jobs WHERE id = ?');
    return stmt.get(id);
  }

  getAll(): any[] {
    const database = this.db.getDatabase();
    const stmt = database.prepare('SELECT * FROM jobs ORDER BY created_at DESC');
    return stmt.all();
  }

  getPending(runnerId?: string): any[] {
    const database = this.db.getDatabase();
    if (runnerId) {
      // Return pending jobs OR running jobs assigned to this runner
      const stmt = database.prepare(`
        SELECT * FROM jobs
        WHERE (status = 'pending' AND runner_id IS NULL)
           OR (status = 'running' AND runner_id = ?)
        ORDER BY created_at ASC
      `);
      return stmt.all(runnerId);
    }
    const stmt = database.prepare("SELECT * FROM jobs WHERE status = 'pending' ORDER BY created_at ASC");
    return stmt.all();
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
}

export class APIKeyRepository {
  private db: SqliteDB;

  constructor(db?: SqliteDB) {
    this.db = db || getDatabase();
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
    return stmt.get(id) as APIKey | undefined;
  }

  getByKey(key: string): APIKey | undefined {
    const database = this.db.getDatabase();
    const stmt = database.prepare('SELECT * FROM api_keys WHERE key = ?');
    return stmt.get(key) as APIKey | undefined;
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
    return stmt.all() as APIKey[];
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
    this.db = db || getDatabase();
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
    let stmt;
    if (options?.resource) {
      stmt = database.prepare('SELECT * FROM audit_logs WHERE resource = ? ORDER BY timestamp DESC LIMIT ?');
      return stmt.all(options.resource, options.limit || 100) as AuditLog[];
    }
    stmt = database.prepare('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT ?');
    return stmt.all(options?.limit || 100) as AuditLog[];
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/server && npm test -- src/db/repository.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/server/src/db/repository.ts apps/server/src/db/repository.test.ts
git commit -m "feat: add SQLite repository classes"
```

---

## Task 4: Update Store to Use SQLite

**Files:**
- Modify: `apps/server/src/db/store.ts`

**Step 1: Read current store.ts**

Run: `cat apps/server/src/db/store.ts`

**Step 2: Update Store to use SQLite**

```typescript
// apps/server/src/db/store.ts
import { getDatabase, SqliteDB, closeDatabase } from './database';
import { SandboxRepository, APIKeyRepository, AuditLogRepository } from './repository';
import { Sandbox, SandboxStatus, APIKey, AuditLog, CreateSandboxRequest, AgentInfo } from '../types';

// For backward compatibility, keep in-memory fallback
import { Store as InMemoryStore } from './store-inmemory';

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
    } else {
      // Fallback to in-memory store
      this.sandboxRepo = null as any;
      this.apiKeyRepo = null as any;
      this.auditRepo = null as any;
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
    // For testing, switch to in-memory
    this.useSqlite = false;
  }
}

// Create singleton with SQLite enabled by default
export const store = new Store(true);
```

**Step 3: Run tests**

Run: `cd apps/server && npm test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add apps/server/src/db/store.ts
git commit -m "feat: update Store to use SQLite persistence"
```

---

## Task 5: Update Job Service to Use SQLite

**Files:**
- Modify: `apps/server/src/services/job.ts`

**Step 1: Read current job.ts**

Run: `cat apps/server/src/services/job.ts`

**Step 2: Update Job service to use SQLite**

```typescript
// apps/server/src/services/job.ts
import { getDatabase } from '../db/database';
import { JobRepository } from '../db/repository';

let jobRepo: JobRepository | null = null;

function getJobRepo(): JobRepository {
  if (!jobRepo) {
    const db = getDatabase();
    jobRepo = new JobRepository(db);
  }
  return jobRepo;
}

export interface Job {
  id: string;
  type: 'create' | 'delete';
  sandboxId: string;
  image: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  runnerId?: string;
  createdAt: string;
  env?: Record<string, string>;
  memory?: string;
  cpu?: number;
  networkMode?: string;
}

/**
 * Create a new job
 */
export function createJob(data: Omit<Job, 'id' | 'status' | 'createdAt'>): Job {
  const repo = getJobRepo();
  const job = repo.create(data);
  return {
    id: job.id,
    type: job.type,
    sandboxId: job.sandbox_id,
    image: job.image,
    status: job.status,
    runnerId: job.runner_id,
    createdAt: job.created_at,
    env: job.env ? JSON.parse(job.env) : undefined,
    memory: job.memory,
    cpu: job.cpu,
    networkMode: job.network_mode,
  };
}

/**
 * Get a job by ID
 */
export function getJob(id: string): Job | undefined {
  const repo = getJobRepo();
  const job = repo.getById(id);
  if (!job) return undefined;
  return {
    id: job.id,
    type: job.type,
    sandboxId: job.sandbox_id,
    image: job.image,
    status: job.status,
    runnerId: job.runner_id,
    createdAt: job.created_at,
    env: job.env ? JSON.parse(job.env) : undefined,
    memory: job.memory,
    cpu: job.cpu,
    networkMode: job.network_mode,
  };
}

/**
 * Get pending jobs, optionally filtered by runnerId
 */
export function getPendingJobs(runnerId?: string): Job[] {
  const repo = getJobRepo();
  return repo.getPending(runnerId).map((job: any) => ({
    id: job.id,
    type: job.type,
    sandboxId: job.sandbox_id,
    image: job.image,
    status: job.status,
    runnerId: job.runner_id,
    createdAt: job.created_at,
    env: job.env ? JSON.parse(job.env) : undefined,
    memory: job.memory,
    cpu: job.cpu,
    networkMode: job.network_mode,
  }));
}

/**
 * Assign a job to a runner
 */
export function assignJob(jobId: string, runnerId: string): boolean {
  const repo = getJobRepo();
  return repo.assign(jobId, runnerId);
}

/**
 * Complete a job
 */
export function completeJob(jobId: string, success: boolean): boolean {
  const repo = getJobRepo();
  return repo.complete(jobId, success);
}

/**
 * Get all jobs
 */
export function getAllJobs(): Job[] {
  const repo = getJobRepo();
  return repo.getAll().map((job: any) => ({
    id: job.id,
    type: job.type,
    sandboxId: job.sandbox_id,
    image: job.image,
    status: job.status,
    runnerId: job.runner_id,
    createdAt: job.created_at,
    env: job.env ? JSON.parse(job.env) : undefined,
    memory: job.memory,
    cpu: job.cpu,
    networkMode: job.network_mode,
  }));
}
```

**Step 3: Run tests**

Run: `cd apps/server && npm test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add apps/server/src/services/job.ts
git commit -m "feat: update Job service to use SQLite"
```

---

## Task 6: Add Data Directory to Docker

**Files:**
- Modify: `docker-compose.yml`

**Step 1: Read current docker-compose.yml**

Run: `cat docker-compose.yml`

**Step 2: Add volume for data persistence**

```yaml
services:
  server:
    volumes:
      - ./data:/app/data
```

**Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add data volume for SQLite persistence"
```

---

## Task 7: Integration Test

**Files:**
- Test against running services

**Step 1: Build and restart services**

```bash
cd docker
docker-compose down
docker-compose build server
docker-compose up -d server
```

**Step 2: Create a sandbox**

```bash
cd apps/cli
./dist/index.js create python:3.11
```

**Step 3: Restart server**

```bash
docker-compose restart server
```

**Step 4: Verify data persists**

```bash
./dist/index.js list
# Should show the sandbox created before restart
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Add SQLite dependencies | package.json |
| 2 | Create database module | db/database.ts, db/database.test.ts |
| 3 | Create repository classes | db/repository.ts, db/repository.test.ts |
| 4 | Update Store to use SQLite | db/store.ts |
| 5 | Update Job service to use SQLite | services/job.ts |
| 6 | Add data volume to Docker | docker-compose.yml |
| 7 | Integration test | - |
