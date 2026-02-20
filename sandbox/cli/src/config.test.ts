/**
 * Config Manager Tests
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { Config } from './types';

const testDir = path.join(os.tmpdir(), 'codepod-test');
const testConfigPath = path.join(testDir, 'config.json');

describe('ConfigManager', () => {
  beforeEach(() => {
    jest.resetModules();
    if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath);
    }
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe('load', () => {
    it('should load from file', async () => {
      // Create test config
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(testConfigPath, JSON.stringify({
        endpoint: 'http://loaded.com',
        apiKey: 'loaded-key',
        output: 'simple',
      }));

      const { ConfigManager } = await import('./config');
      const manager = new ConfigManager();
      (manager as any).configPath = testConfigPath;

      const config = manager.load();

      expect(config.endpoint).toBe('http://loaded.com');
      expect(config.apiKey).toBe('loaded-key');
      expect(config.output).toBe('simple');
    });

    it('should use defaults when file missing', async () => {
      const { ConfigManager } = await import('./config');
      const manager = new ConfigManager();
      (manager as any).configPath = testConfigPath;

      const config = manager.load();

      expect(config.endpoint).toBe('http://localhost:8080');
      expect(config.apiKey).toBe('');
      expect(config.output).toBe('table');
    });

    it('should handle parse error', async () => {
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(testConfigPath, 'invalid json');

      const { ConfigManager } = await import('./config');
      const manager = new ConfigManager();
      (manager as any).configPath = testConfigPath;

      const config = manager.load();

      expect(config.endpoint).toBe('http://localhost:8080');
    });
  });

  describe('save', () => {
    it('should save config to file', async () => {
      const { ConfigManager } = await import('./config');
      const manager = new ConfigManager();
      (manager as any).configPath = testConfigPath;

      manager.save({
        endpoint: 'http://saved.com',
        apiKey: 'saved-key',
        output: 'json',
      });

      const content = fs.readFileSync(testConfigPath, 'utf8');
      const parsed = JSON.parse(content);

      expect(parsed.endpoint).toBe('http://saved.com');
      expect(parsed.apiKey).toBe('saved-key');
      expect(parsed.output).toBe('json');
    });
  });

  describe('getters and setters', () => {
    it('should get and set endpoint', async () => {
      const { ConfigManager } = await import('./config');
      const manager = new ConfigManager();
      (manager as any).configPath = testConfigPath;

      manager.setEndpoint('http://endpoint.com');
      expect(manager.getEndpoint()).toBe('http://endpoint.com');
    });

    it('should get and set API key', async () => {
      const { ConfigManager } = await import('./config');
      const manager = new ConfigManager();
      (manager as any).configPath = testConfigPath;

      manager.setAPIKey('my-key');
      expect(manager.getAPIKey()).toBe('my-key');
    });

    it('should set output format', async () => {
      const { ConfigManager } = await import('./config');
      const manager = new ConfigManager();
      (manager as any).configPath = testConfigPath;

      manager.setOutput('json');
      const config = manager.load();
      expect(config.output).toBe('json');
    });
  });
});

describe('Config Types', () => {
  it('should have correct type definitions', () => {
    const config: Config = {
      endpoint: 'http://localhost:8080',
      apiKey: '',
      output: 'table',
    };

    expect(config.endpoint).toBe('http://localhost:8080');
    expect(config.apiKey).toBe('');
    expect(config.output).toBe('table');
  });

  it('should accept all output formats', () => {
    const formats: Config['output'][] = ['json', 'table', 'simple'];

    formats.forEach(format => {
      const config: Config = {
        endpoint: 'http://test.com',
        apiKey: 'key',
        output: format,
      };
      expect(config.output).toBe(format);
    });
  });
});
