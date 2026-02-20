/**
 * Unit tests for store
 */

import { Store } from './store';

describe('Store', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store();
  });

  describe('createSandbox', () => {
    test('should create sandbox with minimal request', () => {
      const sandbox = store.createSandbox({ image: 'python:3.11' });

      expect(sandbox.id).toBeDefined();
      expect(sandbox.id).toMatch(/^sbox-/);
      expect(sandbox.name).toBeDefined();
      expect(sandbox.status).toBe('pending');
      expect(sandbox.image).toBe('python:3.11');
      expect(sandbox.token).toBeDefined();
    });

    test('should create sandbox with custom name', () => {
      const sandbox = store.createSandbox({
        image: 'python:3.11',
        name: 'my-custom-sandbox',
      });

      expect(sandbox.name).toBe('my-custom-sandbox');
    });

    test('should create sandbox with environment variables', () => {
      const sandbox = store.createSandbox(
        { image: 'python:3.11', env: { DEBUG: 'true' } },
        { customField: 'value' } // metadata
      );

      expect(sandbox.metadata).toBeDefined();
      expect(sandbox.metadata?.customField).toBe('value');
    });
  });

  describe('getSandbox', () => {
    test('should return sandbox by ID', () => {
      const created = store.createSandbox({ image: 'python:3.11' });
      const retrieved = store.getSandbox(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
    });

    test('should return undefined for non-existent ID', () => {
      const result = store.getSandbox('non-existent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('listSandboxes', () => {
    test('should return all sandboxes', () => {
      store.createSandbox({ image: 'python:3.11' });
      store.createSandbox({ image: 'go:1.21' });
      store.createSandbox({ image: 'node:20' });

      const sandboxes = store.listSandboxes();
      expect(sandboxes.length).toBe(3);
    });

    test('should return empty array when no sandboxes', () => {
      const sandboxes = store.listSandboxes();
      expect(sandboxes.length).toBe(0);
    });
  });

  describe('updateSandbox', () => {
    test('should update sandbox status', () => {
      const sandbox = store.createSandbox({ image: 'python:3.11' });

      const updated = store.updateSandbox(sandbox.id, { status: 'running' });

      expect(updated?.status).toBe('running');
    });

    test('should return undefined for non-existent sandbox', () => {
      const result = store.updateSandbox('non-existent', { status: 'running' });
      expect(result).toBeUndefined();
    });
  });

  describe('deleteSandbox', () => {
    test('should delete sandbox', () => {
      const sandbox = store.createSandbox({ image: 'python:3.11' });

      const deleted = store.deleteSandbox(sandbox.id);
      expect(deleted).toBe(true);

      const retrieved = store.getSandbox(sandbox.id);
      expect(retrieved).toBeUndefined();
    });

    test('should return false for non-existent sandbox', () => {
      const result = store.deleteSandbox('non-existent-id');
      expect(result).toBe(false);
    });
  });

  describe('API Keys', () => {
    test('should create API key', () => {
      const apiKey = store.createAPIKey({ name: 'test-key' });

      expect(apiKey.key).toBeDefined();
      expect(apiKey.key).toMatch(/^cp_/);
      expect(apiKey.name).toBe('test-key');
    });

    test('should validate API key', () => {
      const apiKey = store.createAPIKey({ name: 'test' });
      const validated = store.validateAPIKey(apiKey.key);

      expect(validated).toBeDefined();
      expect(validated?.name).toBe('test');
    });

    test('should reject invalid API key', () => {
      const result = store.validateAPIKey('invalid-key');
      expect(result).toBeUndefined();
    });

    test('should revoke API key', () => {
      const apiKey = store.createAPIKey({ name: 'revoke-test' });

      const revoked = store.revokeAPIKey(apiKey.key);
      expect(revoked).toBe(true);

      const validated = store.validateAPIKey(apiKey.key);
      expect(validated).toBeUndefined();
    });
  });

  describe('Audit Logs', () => {
    test('should log actions', () => {
      store.createSandbox({ image: 'python:3.11' });
      store.createSandbox({ image: 'go:1.21' });

      const logs = store.getAuditLogs({ limit: 100 });
      expect(logs.length).toBeGreaterThanOrEqual(2);
    });

    test('should filter logs by resource', () => {
      store.createSandbox({ image: 'python:3.11' });
      store.createAPIKey({ name: 'test' });

      const sandboxLogs = store.getAuditLogs({ resource: 'sandbox' });
      const apiKeyLogs = store.getAuditLogs({ resource: 'api_key' });

      expect(sandboxLogs.length).toBeGreaterThan(0);
      expect(apiKeyLogs.length).toBeGreaterThan(0);
    });
  });

  describe('Stats', () => {
    test('should return correct stats', () => {
      store.createSandbox({ image: 'python:3.11' });
      store.createSandbox({ image: 'go:1.21' });

      const stats = store.getStats();

      expect(stats.totalSandboxes).toBe(2);
      expect(stats.runningSandboxes).toBe(0);
      expect(stats.totalAPIKeys).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Reset', () => {
    test('should reset store', () => {
      store.createSandbox({ image: 'python:3.11' });
      store.createSandbox({ image: 'go:1.21' });

      store.reset();

      expect(store.listSandboxes().length).toBe(0);
    });
  });
});
