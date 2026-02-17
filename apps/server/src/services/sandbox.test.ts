/**
 * Unit tests for sandbox service
 */

import { SandboxService } from './sandbox';
import { store } from '../db/store';

describe('SandboxService', () => {
  let service: SandboxService;

  beforeEach(() => {
    store.reset(); // Clear shared state
    service = new SandboxService();
  });

  describe('create', () => {
    test('should create sandbox with minimal request', () => {
      const result = service.create({ image: 'python:3.11' });

      expect(result.sandbox.id).toBeDefined();
      expect(result.sandbox.status).toBe('pending');
      expect(result.sandbox.image).toBe('python:3.11');
      expect(result.token).toBeDefined();
      expect(result.sshHost).toBe('localhost');
      expect(result.sshPort).toBe(2222);
      expect(result.sshUser).toBe('root');
    });

    test('should create sandbox with custom name', () => {
      const result = service.create({
        image: 'python:3.11',
        name: 'my-sandbox',
      });

      expect(result.sandbox.name).toBe('my-sandbox');
    });

    test('should throw error for missing image', () => {
      expect(() => {
        service.create({} as any);
      }).toThrow('Image is required');
    });
  });

  describe('get', () => {
    test('should return sandbox by ID', () => {
      const created = service.create({ image: 'python:3.11' });
      const sandbox = service.get(created.sandbox.id);

      expect(sandbox).toBeDefined();
      expect(sandbox?.id).toBe(created.sandbox.id);
    });

    test('should return undefined for non-existent ID', () => {
      const result = service.get('non-existent');
      expect(result).toBeUndefined();
    });
  });

  describe('list', () => {
    test('should return all sandboxes', () => {
      service.create({ image: 'python:3.11' });
      service.create({ image: 'go:1.21' });
      service.create({ image: 'node:20' });

      const result = service.list();

      expect(result.sandboxes.length).toBe(3);
      expect(result.total).toBe(3);
    });
  });

  describe('delete', () => {
    test('should delete sandbox', () => {
      const created = service.create({ image: 'python:3.11' });

      const deleted = service.delete(created.sandbox.id);
      expect(deleted).toBe(true);

      const retrieved = service.get(created.sandbox.id);
      expect(retrieved).toBeUndefined();
    });

    test('should return false for non-existent sandbox', () => {
      const result = service.delete('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('updateStatus', () => {
    test('should update sandbox status to running', () => {
      const created = service.create({ image: 'python:3.11' });

      const updated = service.updateStatus(created.sandbox.id, 'running');
      expect(updated?.status).toBe('running');
    });

    test('should update sandbox status to stopped', () => {
      const created = service.create({ image: 'python:3.11' });
      service.updateStatus(created.sandbox.id, 'running');

      const updated = service.updateStatus(created.sandbox.id, 'stopped');
      expect(updated?.status).toBe('stopped');
    });
  });

  describe('getConnectionToken', () => {
    test('should return connection token', () => {
      const created = service.create({ image: 'python:3.11' });
      // Create generates a new token, so getConnectionToken returns a different one
      const token = service.getConnectionToken(created.sandbox.id);
      expect(token).toBeDefined();
      // The token should be stored in the sandbox
      const retrieved = service.get(created.sandbox.id);
      expect(retrieved?.token).toBeDefined();
    });

    test('should return undefined for non-existent sandbox', () => {
      const result = service.getConnectionToken('non-existent');
      expect(result).toBeUndefined();
    });
  });

  describe('getStats', () => {
    test('should return correct stats', () => {
      service.create({ image: 'python:3.11' });
      service.create({ image: 'go:1.21' });

      const stats = service.getStats();

      expect(stats.total).toBe(2);
      expect(stats.pending).toBe(2);
      expect(stats.running).toBe(0);
      expect(stats.stopped).toBe(0);
    });

    test('should count running sandboxes', () => {
      const s1 = service.create({ image: 'python:3.11' });
      service.create({ image: 'go:1.21' });
      service.updateStatus(s1.sandbox.id, 'running');

      const stats = service.getStats();

      expect(stats.total).toBe(2);
      expect(stats.running).toBe(1);
      expect(stats.pending).toBe(1);
    });
  });
});
