/**
 * Unit tests for ExternalRegistryService
 */

import * as fs from 'fs';
import * as path from 'path';
import { ExternalRegistryService } from './external';

describe('ExternalRegistryService', () => {
  let service: ExternalRegistryService;
  const testConfigDir = '/tmp/test-external-registry-' + Date.now();
  const testConfigFile = path.join(testConfigDir, 'external.json');

  beforeEach(() => {
    // Clean up before each test
    fs.rmSync(testConfigDir, { recursive: true, force: true });
    process.env.CODEPOD_REGISTRY_CONFIG = testConfigFile;
    service = new ExternalRegistryService();
    // Clear any state from previous tests
    service.clear();
  });

  afterEach(() => {
    delete process.env.CODEPOD_REGISTRY_CONFIG;
    fs.rmSync(testConfigDir, { recursive: true, force: true });
  });

  describe('createHarborConfig', () => {
    test('should create harbor config', () => {
      const config = service.createHarborConfig('harbor.example.com', 'admin', 'password123');

      expect(config.type).toBe('harbor');
      expect(config.endpoint).toBe('https://harbor.example.com');
      expect(config.auth.type).toBe('basic');
      expect(config.auth.username).toBe('admin');
      expect(config.id).toMatch(/^harbor-\d+$/);
    });
  });

  describe('createDockerHubConfig', () => {
    test('should create dockerhub config', () => {
      const config = service.createDockerHubConfig('mytoken');

      expect(config.type).toBe('dockerhub');
      expect(config.endpoint).toBe('https://index.docker.io/v1/');
      expect(config.auth.type).toBe('bearer');
      expect(config.auth.registryToken).toBe('mytoken');
    });
  });

  describe('createECRConfig', () => {
    test('should create ECR config', () => {
      const config = service.createECRConfig('us-east-1');

      expect(config.type).toBe('ecr');
      expect(config.endpoint).toBe('us-east-1.dkr.ecr.us-east-1.amazonaws.com');
      expect(config.auth.type).toBe('aws-iam');
    });
  });

  describe('createCustomConfig', () => {
    test('should create custom config', () => {
      const config = service.createCustomConfig('My Registry', 'http://localhost:5000', 'basic', 'user', 'pass', true);

      expect(config.type).toBe('custom');
      expect(config.name).toBe('My Registry');
      expect(config.endpoint).toBe('http://localhost:5000');
      expect(config.insecure).toBe(true);
      expect(config.auth.type).toBe('basic');
    });
  });

  describe('list', () => {
    test('should list all registries', () => {
      const harbor = service.createHarborConfig('harbor1.example.com', 'admin', 'pass');
      const dockerhub = service.createDockerHubConfig('token');

      const list = service.list();

      expect(list).toHaveLength(2);
      expect(list.find(r => r.id === harbor.id)).toBeDefined();
      expect(list.find(r => r.id === dockerhub.id)).toBeDefined();
    });
  });

  describe('get', () => {
    test('should return registry by ID', () => {
      const created = service.createHarborConfig('harbor.example.com', 'admin', 'pass');
      const retrieved = service.get(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.endpoint).toBe('https://harbor.example.com');
    });

    test('should return undefined for non-existent ID', () => {
      const retrieved = service.get('non-existent-id');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('delete', () => {
    test('should delete registry', () => {
      const created = service.createHarborConfig('harbor.example.com', 'admin', 'pass');
      const deleted = service.delete(created.id);

      expect(deleted).toBe(true);
      expect(service.get(created.id)).toBeUndefined();
      expect(service.list()).toHaveLength(0);
    });

    test('should return false for non-existent registry', () => {
      const deleted = service.delete('non-existent-id');
      expect(deleted).toBe(false);
    });

    test('should delete only specified registry', () => {
      const harbor = service.createHarborConfig('harbor.example.com', 'admin', 'pass');
      const dockerhub = service.createDockerHubConfig('token');

      service.delete(harbor.id);

      expect(service.list()).toHaveLength(1);
      expect(service.list()[0].id).toBe(dockerhub.id);
    });
  });

  describe('testConnection', () => {
    test('should return true for valid config', async () => {
      const config = service.createCustomConfig('Test', 'http://localhost:5000', 'basic', 'user', 'pass', true);
      const result = await service.testConnection(config);

      expect(result).toBe(true);
    });

    test('should return false for missing endpoint', async () => {
      const config = service.createCustomConfig('Test', '', 'basic', 'user', 'pass', false);
      const result = await service.testConnection(config);

      expect(result).toBe(false);
    });
  });
});
