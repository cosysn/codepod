/**
 * CodePod SDK Client Tests
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { CodePodClient, ErrorResponse } from '../src';

// Test constants
const BASE_URL = 'http://localhost:8080';
const API_KEY = 'test-api-key';

describe('CodePodClient', () => {
  let client: CodePodClient;
  let axiosInstance: AxiosInstance;
  let mock: MockAdapter;

  beforeEach(() => {
    // Create a custom axios instance
    axiosInstance = axios.create({
      baseURL: BASE_URL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
      },
    });

    client = new CodePodClient({ baseURL: BASE_URL, apiKey: API_KEY });

    // Replace the axios instance with our mocked one
    (client as any).client = axiosInstance;

    mock = new MockAdapter(axiosInstance);
  });

  afterEach(() => {
    mock.restore();
  });

  // ==================== Health Tests ====================

  describe('health', () => {
    it('should return health status', async () => {
      const healthData = { status: 'ok', version: '1.0.0' };
      mock.onGet('/health').reply(200, healthData);

      const result = await client.health();

      expect(result).toEqual(healthData);
      expect(result.status).toBe('ok');
    });

    it('should handle health check error', async () => {
      mock.onGet('/health').networkError();

      await expect(client.health()).rejects.toThrow();
    });
  });

  // ==================== Sandbox Tests ====================

  describe('createSandbox', () => {
    it('should create a sandbox successfully', async () => {
      const request = { image: 'ubuntu:22.04', name: 'test-sandbox' };
      const response = {
        sandbox: {
          id: 'sandbox-123',
          name: 'test-sandbox',
          status: 'pending',
          image: 'ubuntu:22.04',
          host: 'localhost',
          port: 22,
          user: 'root',
          createdAt: '2024-01-01T00:00:00Z',
        },
        sshHost: 'localhost',
        sshPort: 22,
        sshUser: 'root',
        token: 'test-token',
      };
      mock.onPost('/api/v1/sandboxes').reply(201, response);

      const result = await client.createSandbox(request);

      expect(result.sandbox.id).toBe('sandbox-123');
      expect(result.sshHost).toBe('localhost');
      expect(result.token).toBe('test-token');
    });

    it('should create sandbox with resources', async () => {
      const request = { image: 'ubuntu:22.04', cpu: 4, memory: '8Gi' };
      const response = {
        sandbox: { id: 'sandbox-456', status: 'pending', image: 'ubuntu:22.04', host: 'localhost', port: 22, user: 'root', name: '', createdAt: '' },
        sshHost: 'localhost',
        sshPort: 22,
        sshUser: 'root',
        token: 'token',
      };
      mock.onPost('/api/v1/sandboxes').reply(201, response);

      const result = await client.createSandbox(request);

      expect(result.sandbox.status).toBe('pending');
    });

    it('should create sandbox with volumes', async () => {
      const request = {
        image: 'ubuntu:22.04',
        volumes: [{ volumeId: 'vol-123', mountPath: '/workspace' }],
      };
      const response = {
        sandbox: { id: 'sandbox-789', status: 'pending', image: 'ubuntu:22.04', host: 'localhost', port: 22, user: 'root', name: '', createdAt: '' },
        sshHost: 'localhost',
        sshPort: 22,
        sshUser: 'root',
        token: 'token',
      };
      mock.onPost('/api/v1/sandboxes').reply(201, response);

      const result = await client.createSandbox(request);

      expect(result.sandbox.id).toBe('sandbox-789');
    });
  });

  describe('getSandbox', () => {
    it('should get a sandbox by ID', async () => {
      const sandbox = {
        id: 'sandbox-123',
        name: 'test-sandbox',
        status: 'running' as const,
        image: 'ubuntu:22.04',
        host: 'localhost',
        port: 22,
        user: 'root',
        createdAt: '2024-01-01T00:00:00Z',
      };
      mock.onGet('/api/v1/sandboxes/sandbox-123').reply(200, { sandbox });

      const result = await client.getSandbox('sandbox-123');

      expect(result.id).toBe('sandbox-123');
      expect(result.status).toBe('running');
    });

    it('should handle sandbox not found', async () => {
      mock.onGet('/api/v1/sandboxes/not-found').reply(404, { code: 404, message: 'Not found' });

      await expect(client.getSandbox('not-found')).rejects.toThrow();
    });
  });

  describe('listSandboxes', () => {
    it('should list all sandboxes', async () => {
      const sandboxes = [
        { id: 'sandbox-1', name: 'sandbox-1', status: 'running' as const, image: 'ubuntu:22.04', host: 'localhost', port: 22, user: 'root', createdAt: '' },
        { id: 'sandbox-2', name: 'sandbox-2', status: 'stopped' as const, image: 'ubuntu:22.04', host: 'localhost', port: 22, user: 'root', createdAt: '' },
      ];
      mock.onGet('/api/v1/sandboxes').reply(200, { sandboxes, total: 2 });

      const result = await client.listSandboxes();

      expect(result.sandboxes).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.sandboxes[0].id).toBe('sandbox-1');
    });

    it('should return empty list when no sandboxes', async () => {
      mock.onGet('/api/v1/sandboxes').reply(200, { sandboxes: [], total: 0 });

      const result = await client.listSandboxes();

      expect(result.sandboxes).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('deleteSandbox', () => {
    it('should delete a sandbox successfully', async () => {
      mock.onDelete('/api/v1/sandboxes/sandbox-123').reply(200, { success: true });

      const result = await client.deleteSandbox('sandbox-123');

      expect(result.success).toBe(true);
    });
  });

  describe('stopSandbox', () => {
    it('should stop a sandbox', async () => {
      mock.onPost('/api/v1/sandboxes/sandbox-123/stop').reply(200);

      await expect(client.stopSandbox('sandbox-123')).resolves.not.toThrow();
    });
  });

  describe('restartSandbox', () => {
    it('should restart a sandbox', async () => {
      mock.onPost('/api/v1/sandboxes/sandbox-123/restart').reply(200);

      await expect(client.restartSandbox('sandbox-123')).resolves.not.toThrow();
    });
  });

  describe('getSandboxToken', () => {
    it('should get sandbox token', async () => {
      const tokenResponse = { token: 'sandbox-token-123' };
      mock.onPost('/api/v1/sandboxes/sandbox-123/token').reply(200, tokenResponse);

      const result = await client.getSandboxToken('sandbox-123');

      expect(result.token).toBe('sandbox-token-123');
    });
  });

  describe('updateSandboxStatus', () => {
    it('should update sandbox status', async () => {
      mock.onPost('/api/v1/sandboxes/sandbox-123/status').reply(200, { success: true });

      const result = await client.updateSandboxStatus('sandbox-123', 'running', {
        cpuPercent: 50,
        memoryMB: 1024,
      });

      expect(result.success).toBe(true);
    });
  });

  // ==================== Volume Tests ====================

  describe('createVolume', () => {
    it('should create a volume successfully', async () => {
      const request = { name: 'workspace-volume', size: '10Gi' };
      const response = { volumeId: 'vol-123', hostPath: '/var/lib/docker/volumes/vol-123/_data' };
      mock.onPost('/api/v1/volumes').reply(201, response);

      const result = await client.createVolume(request);

      expect(result.volumeId).toBe('vol-123');
      expect(result.hostPath).toBe('/var/lib/docker/volumes/vol-123/_data');
    });
  });

  describe('getVolume', () => {
    it('should get a volume by ID', async () => {
      const volume = { id: 'vol-123', name: 'workspace-volume', size: '10Gi', createdAt: '2024-01-01T00:00:00Z' };
      mock.onGet('/api/v1/volumes/vol-123').reply(200, { volume });

      const result = await client.getVolume('vol-123');

      expect(result.id).toBe('vol-123');
      expect(result.name).toBe('workspace-volume');
    });
  });

  describe('listVolumes', () => {
    it('should list all volumes', async () => {
      const volumes = [
        { id: 'vol-1', name: 'volume-1', size: '10Gi', createdAt: '' },
        { id: 'vol-2', name: 'volume-2', size: '20Gi', createdAt: '' },
      ];
      mock.onGet('/api/v1/volumes').reply(200, { volumes });

      const result = await client.listVolumes();

      expect(result.volumes).toHaveLength(2);
    });
  });

  describe('deleteVolume', () => {
    it('should delete a volume', async () => {
      mock.onDelete('/api/v1/volumes/vol-123').reply(200, { success: true });

      const result = await client.deleteVolume('vol-123');

      expect(result.success).toBe(true);
    });
  });

  // ==================== API Key Tests ====================

  describe('createAPIKey', () => {
    it('should create an API key', async () => {
      const request = { name: 'test-key' };
      const response = {
        key: { id: 'key-123', key: 'key-abc', name: 'test-key', createdAt: '2024-01-01T00:00:00Z' },
        rawKey: 'codepod_sk_abc123',
      };
      mock.onPost('/api/v1/keys').reply(201, response);

      const result = await client.createAPIKey(request);

      expect(result.key.id).toBe('key-123');
      expect(result.rawKey).toBe('codepod_sk_abc123');
    });
  });

  describe('listAPIKeys', () => {
    it('should list all API keys', async () => {
      const keys = [
        { id: 'key-1', key: 'key-abc', name: 'key-1', createdAt: '' },
        { id: 'key-2', key: 'key-def', name: 'key-2', createdAt: '' },
      ];
      mock.onGet('/api/v1/keys').reply(200, { keys });

      const result = await client.listAPIKeys();

      expect(result.keys).toHaveLength(2);
    });
  });

  describe('deleteAPIKey', () => {
    it('should delete an API key', async () => {
      mock.onDelete('/api/v1/keys/key-123').reply(200, { success: true });

      const result = await client.deleteAPIKey('key-123');

      expect(result.success).toBe(true);
    });
  });

  // ==================== Stats Tests ====================

  describe('getStats', () => {
    it('should return server statistics', async () => {
      const stats = {
        totalSandboxes: 10,
        runningSandboxes: 5,
        cpuUsage: 75,
        memoryUsage: 60,
      };
      mock.onGet('/api/v1/stats').reply(200, stats);

      const result = await client.getStats();

      expect(result.totalSandboxes).toBe(10);
      expect(result.runningSandboxes).toBe(5);
    });
  });

  // ==================== Error Handling Tests ====================

  describe('handleError', () => {
    it('should handle axios error with response', () => {
      const error = {
        isAxiosError: true,
        response: {
          status: 400,
          data: { code: 400, message: 'Bad Request', details: 'Invalid input' },
        },
        message: 'Request failed',
      } as unknown as AxiosError<ErrorResponse>;

      const result = CodePodClient.handleError(error);

      expect(result.code).toBe(400);
      expect(result.message).toBe('Bad Request');
      expect(result.details).toBe('Invalid input');
    });

    it('should handle axios error without response', () => {
      const error = {
        isAxiosError: true,
        response: null,
        message: 'Network Error',
      } as unknown as AxiosError<ErrorResponse>;

      const result = CodePodClient.handleError(error);

      expect(result.code).toBe(500);
      expect(result.message).toBe('Network Error');
    });

    it('should handle non-axios error', () => {
      const error = new Error('Unknown error');

      const result = CodePodClient.handleError(error);

      expect(result.code).toBe(500);
      expect(result.message).toBe('Unknown error');
    });
  });

  // ==================== Client Configuration Tests ====================

  describe('constructor', () => {
    it('should create client with default timeout', () => {
      const client = new CodePodClient({ baseURL: BASE_URL });

      expect(client).toBeInstanceOf(CodePodClient);
    });

    it('should create client with custom timeout', () => {
      const client = new CodePodClient({ baseURL: BASE_URL, timeout: 60000 });

      expect(client).toBeInstanceOf(CodePodClient);
    });

    it('should create client without API key', () => {
      const client = new CodePodClient({ baseURL: BASE_URL });

      expect(client).toBeInstanceOf(CodePodClient);
    });
  });

  describe('setAPIKey', () => {
    it('should update API key', () => {
      const newClient = new CodePodClient({ baseURL: BASE_URL });

      expect(() => newClient.setAPIKey('new-key')).not.toThrow();
    });
  });
});
