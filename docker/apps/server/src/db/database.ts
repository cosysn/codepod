import Database from 'better-sqlite3';
import path from 'path';
import * as fs from 'fs';

export class SqliteDB {
  private db: Database.Database;
  private dataDir: string;

  constructor(dataDir?: string) {
    this.dataDir = dataDir || process.env.DATA_DIR || './data';
    // Ensure data directory exists
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
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
