/**
 * SQLite Database Module
 */

import Database, { Database as DatabaseType } from 'better-sqlite3';

export class SqliteDB {
  private db: DatabaseType;

  constructor(path: string = ':memory:') {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.initializeTables();
  }

  private initializeTables(): void {
    // Create sandboxes table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sandboxes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        image TEXT NOT NULL,
        host TEXT NOT NULL DEFAULT 'localhost',
        port INTEGER NOT NULL DEFAULT 0,
        user TEXT NOT NULL DEFAULT 'root',
        token TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT,
        metadata TEXT,
        agent_info TEXT,
        runner_id TEXT,
        container_id TEXT
      )
    `);

    // Create jobs table (no foreign key constraint - sandbox_id is optional)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        sandbox_id TEXT,
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

    // Create api_keys table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT,
        last_used_at TEXT
      )
    `);

    // Create audit_logs table
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

    // Create indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sandboxes_status ON sandboxes(status);
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
    `);
  }

  getDatabase(): DatabaseType {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}

// Singleton instance for backward compatibility
let dbInstance: SqliteDB | null = null;

export function initDatabase(path?: string): SqliteDB {
  if (!dbInstance) {
    dbInstance = new SqliteDB(path || process.env.CODEPOD_DB_PATH || ':memory:');
  }
  return dbInstance;
}

export function getDatabase(): SqliteDB {
  if (!dbInstance) {
    dbInstance = new SqliteDB(process.env.CODEPOD_DB_PATH || ':memory:');
  }
  return dbInstance;
}
