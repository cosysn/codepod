import { SqliteDB } from './database';

describe('SqliteDB', () => {
  it('should create database instance in memory', () => {
    const db = new SqliteDB(':memory:');
    expect(db).toBeDefined();
    db.close();
  });

  it('should initialize tables', () => {
    const db = new SqliteDB(':memory:');
    const database = db.getDatabase();
    expect(database).toBeDefined();
    db.close();
  });
});
