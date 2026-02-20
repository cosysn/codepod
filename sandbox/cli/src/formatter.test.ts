/**
 * Formatter Tests
 */

import { Formatter } from './formatter';
import { Sandbox } from './types';

describe('Formatter', () => {
  let formatter: Formatter;

  beforeEach(() => {
    formatter = new Formatter('table');
  });

  describe('formatSandboxList', () => {
    it('should format empty list', () => {
      const result = formatter.formatSandboxList([]);
      expect(result).toBe('No sandboxes found.');
    });

    it('should format as table', () => {
      const sandboxes: Sandbox[] = [
        {
          id: '1234567890abcdef',
          name: 'test-sandbox',
          status: 'running',
          image: 'ubuntu:20.04',
          host: 'localhost',
          port: 2222,
          user: 'root',
          createdAt: '2024-01-01T00:00:00Z',
        },
      ];

      const result = formatter.formatSandboxList(sandboxes);

      expect(result).toContain('12345678');
      expect(result).toContain('test-sandbox');
      expect(result).toContain('running');
      expect(result).toContain('ubuntu:20.04');
    });

    it('should format as JSON', () => {
      formatter.setFormat('json');
      const sandboxes: Sandbox[] = [
        {
          id: '1234567890abcdef',
          name: 'test-sandbox',
          status: 'running',
          image: 'ubuntu:20.04',
          host: 'localhost',
          port: 2222,
          user: 'root',
          createdAt: '2024-01-01T00:00:00Z',
        },
      ];

      const result = formatter.formatSandboxList(sandboxes);
      const parsed = JSON.parse(result);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe('test-sandbox');
    });

    it('should format as simple', () => {
      formatter.setFormat('simple');
      const sandboxes: Sandbox[] = [
        {
          id: '1234567890abcdef',
          name: 'test-sandbox',
          status: 'running',
          image: 'ubuntu:20.04',
          host: 'localhost',
          port: 2222,
          user: 'root',
          createdAt: '2024-01-01T00:00:00Z',
        },
      ];

      const result = formatter.formatSandboxList(sandboxes);

      expect(result).toBe('1234567890abcdef\ttest-sandbox\trunning\tubuntu:20.04');
    });
  });

  describe('formatSandbox', () => {
    it('should format sandbox detail as table-style', () => {
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

      const result = formatter.formatSandbox(sandbox);

      expect(result).toContain('ID: 1234567890abcdef');
      expect(result).toContain('Name: test-sandbox');
      expect(result).toContain('Status: running');
      expect(result).toContain('Host: localhost:2222');
      expect(result).toContain('User: root');
    });

    it('should format as JSON', () => {
      formatter.setFormat('json');
      const sandbox: Sandbox = {
        id: '1234567890abcdef',
        name: 'test-sandbox',
        status: 'running',
        image: 'ubuntu:20.04',
        host: 'localhost',
        port: 2222,
        user: 'root',
        createdAt: '2024-01-01T00:00:00Z',
      };

      const result = formatter.formatSandbox(sandbox);
      const parsed = JSON.parse(result);

      expect(parsed.name).toBe('test-sandbox');
    });
  });
});
