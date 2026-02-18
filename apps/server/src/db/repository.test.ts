import { SandboxRepository, JobRepository, APIKeyRepository, AuditLogRepository } from './repository';
import { SqliteDB } from './database';

describe('Repositories', () => {
  let db: SqliteDB;

  beforeAll(() => {
    db = new SqliteDB(':memory:');
  });

  afterAll(() => {
    db.close();
  });

  it('should create SandboxRepository', () => {
    const repo = new SandboxRepository(db);
    expect(repo).toBeDefined();
  });

  it('should create JobRepository', () => {
    const repo = new JobRepository(db);
    expect(repo).toBeDefined();
  });

  it('should create APIKeyRepository', () => {
    const repo = new APIKeyRepository(db);
    expect(repo).toBeDefined();
  });

  it('should create AuditLogRepository', () => {
    const repo = new AuditLogRepository(db);
    expect(repo).toBeDefined();
  });
});
