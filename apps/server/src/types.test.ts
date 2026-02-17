/**
 * Unit tests for types
 */

import { SandboxStatus, CreateSandboxRequest } from './types';

describe('Types', () => {
  describe('SandboxStatus', () => {
    test('should have all expected status values', () => {
      const statuses: SandboxStatus[] = [
        'pending',
        'running',
        'stopped',
        'failed',
        'deleted',
      ];

      for (const status of statuses) {
        expect(status).toBeDefined();
      }
    });
  });

  describe('CreateSandboxRequest', () => {
    test('should allow minimal request', () => {
      const req: CreateSandboxRequest = {
        image: 'python:3.11',
      };

      expect(req.image).toBe('python:3.11');
      expect(req.name).toBeUndefined();
    });

    test('should allow full request', () => {
      const req: CreateSandboxRequest = {
        name: 'my-sandbox',
        image: 'python:3.11',
        cpu: 2,
        memory: '2Gi',
        env: { DEBUG: 'true' },
        timeout: 3600,
      };

      expect(req.name).toBe('my-sandbox');
      expect(req.image).toBe('python:3.11');
      expect(req.cpu).toBe(2);
      expect(req.memory).toBe('2Gi');
      expect(req.env?.DEBUG).toBe('true');
      expect(req.timeout).toBe(3600);
    });
  });
});
