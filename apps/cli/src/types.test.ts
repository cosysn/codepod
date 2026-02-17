/**
 * Types Tests
 */

import { Sandbox, CreateSandboxRequest, Config, SandboxStatus } from './types';

describe('Types', () => {
  describe('SandboxStatus', () => {
    it('should allow all valid statuses', () => {
      const statuses: SandboxStatus[] = ['pending', 'running', 'stopped', 'failed', 'deleted'];

      expect(statuses).toHaveLength(5);
    });
  });

  describe('Sandbox interface', () => {
    it('should accept valid sandbox object', () => {
      const sandbox: Sandbox = {
        id: '1234567890abcdef',
        name: 'test-sandbox',
        status: 'running',
        image: 'ubuntu:20.04',
        host: 'localhost',
        port: 2222,
        user: 'root',
        createdAt: '2024-01-01T00:00:00Z',
        startedAt: '2024-01-01T00:01:00Z',
      };

      expect(sandbox.id).toBe('1234567890abcdef');
      expect(sandbox.status).toBe('running');
    });

    it('should work without optional fields', () => {
      const sandbox: Sandbox = {
        id: '1234567890abcdef',
        name: 'test-sandbox',
        status: 'pending',
        image: 'ubuntu:20.04',
        host: 'localhost',
        port: 2222,
        user: 'root',
        createdAt: '2024-01-01T00:00:00Z',
      };

      expect(sandbox.startedAt).toBeUndefined();
    });
  });

  describe('CreateSandboxRequest interface', () => {
    it('should accept minimal request', () => {
      const request: CreateSandboxRequest = {
        image: 'ubuntu:20.04',
      };

      expect(request.image).toBe('ubuntu:20.04');
    });

    it('should accept full request', () => {
      const request: CreateSandboxRequest = {
        name: 'my-sandbox',
        image: 'ubuntu:20.04',
        cpu: 2,
        memory: '1GB',
        env: { NODE_ENV: 'production' },
        timeout: 3600,
      };

      expect(request.name).toBe('my-sandbox');
      expect(request.cpu).toBe(2);
      expect(request.memory).toBe('1GB');
      expect(request.env?.NODE_ENV).toBe('production');
    });
  });

  describe('Config interface', () => {
    it('should accept valid config', () => {
      const config: Config = {
        endpoint: 'http://localhost:8080',
        apiKey: 'test-key',
        output: 'table',
      };

      expect(config.endpoint).toBe('http://localhost:8080');
      expect(config.output).toBe('table');
    });

    it('should accept all output formats', () => {
      const formats: Config['output'][] = ['json', 'table', 'simple'];

      formats.forEach(format => {
        const config: Config = {
          endpoint: 'http://localhost:8080',
          apiKey: '',
          output: format,
        };
        expect(config.output).toBe(format);
      });
    });
  });
});
