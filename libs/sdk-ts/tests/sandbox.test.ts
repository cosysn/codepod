/**
 * CodePod SDK Sandbox Tests
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { CodePodClient, Sandbox, ErrorResponse, SandboxStatus } from '../src';

// Test constants
const BASE_URL = 'http://localhost:8080';
const API_KEY = 'test-api-key';

describe('Sandbox', () => {
  let client: CodePodClient;
  let axiosInstance: AxiosInstance;
  let mock: MockAdapter;
  let sandbox: Sandbox;

  beforeEach(() => {
    axiosInstance = axios.create({
      baseURL: BASE_URL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
      },
    });

    client = new CodePodClient({ baseURL: BASE_URL, apiKey: API_KEY });
    (client as any).client = axiosInstance;
    mock = new MockAdapter(axiosInstance);

    const sandboxData = {
      id: 'sandbox-123',
      name: 'test-sandbox',
      status: 'running' as SandboxStatus,
      image: 'ubuntu:22.04',
      host: 'localhost',
      port: 22,
      user: 'root',
      token: 'test-token',
      createdAt: '2024-01-01T00:00:00Z',
    };
    sandbox = new Sandbox(client, sandboxData);
  });

  afterEach(() => {
    mock.restore();
  });

  // ==================== Properties Tests ====================

  describe('properties', () => {
    it('should return correct id', () => {
      expect(sandbox.id).toBe('sandbox-123');
    });

    it('should return correct name', () => {
      expect(sandbox.name).toBe('test-sandbox');
    });

    it('should return correct status', () => {
      expect(sandbox.status).toBe('running');
    });

    it('should return correct host', () => {
      expect(sandbox.host).toBe('localhost');
    });

    it('should return correct port', () => {
      expect(sandbox.port).toBe(22);
    });

    it('should return correct user', () => {
      expect(sandbox.user).toBe('root');
    });

    it('should return correct ssh config', () => {
      expect(sandbox.sshConfig).toEqual({
        host: 'localhost',
        port: 22,
        user: 'root',
        password: 'test-token',
      });
    });

    it('should return isRunning true for running sandbox', () => {
      expect(sandbox.isRunning).toBe(true);
    });

    it('should return isRunning false for pending sandbox', () => {
      const pendingSandbox = new Sandbox(client, {
        id: 'sandbox-pending',
        name: 'pending',
        status: 'pending' as SandboxStatus,
        image: 'ubuntu:22.04',
        host: 'localhost',
        port: 22,
        user: 'root',
        createdAt: '',
      });
      expect(pendingSandbox.isRunning).toBe(false);
    });
  });

  // ==================== Token Tests ====================

  describe('getToken', () => {
    it('should get sandbox token', async () => {
      mock.onPost('/api/v1/sandboxes/sandbox-123/token').reply(200, { token: 'new-token' });

      const token = await sandbox.getToken();

      expect(token).toBe('new-token');
    });
  });

  // ==================== Lifecycle Tests ====================

  describe('stop', () => {
    it('should stop the sandbox', async () => {
      mock.onPost('/api/v1/sandboxes/sandbox-123/stop').reply(200);

      await expect(sandbox.stop()).resolves.not.toThrow();
    });
  });

  describe('start', () => {
    it('should start the sandbox and wait for running', async () => {
      mock.onPost('/api/v1/sandboxes/sandbox-123/restart').reply(200);
      // Mock getSandbox for waitForRunning
      mock.onGet('/api/v1/sandboxes/sandbox-123').reply(200, {
        sandbox: {
          id: 'sandbox-123',
          name: 'test-sandbox',
          status: 'running',
          image: 'ubuntu:22.04',
          host: 'localhost',
          port: 22,
          user: 'root',
          createdAt: '2024-01-01T00:00:00Z',
        },
      });

      await expect(sandbox.start()).resolves.not.toThrow();
    });
  });

  describe('delete', () => {
    it('should delete the sandbox', async () => {
      mock.onDelete('/api/v1/sandboxes/sandbox-123').reply(200, { success: true });

      await expect(sandbox.delete()).resolves.not.toThrow();
    });
  });

  // ==================== File Operations (Placeholders) ====================

  describe('file operations', () => {
    it('uploadFile should throw error', async () => {
      await expect(sandbox.uploadFile('/test.txt', 'content')).rejects.toThrow('requires SSH connection');
    });

    it('downloadFile should throw error', async () => {
      await expect(sandbox.downloadFile('/test.txt')).rejects.toThrow('requires SSH connection');
    });

    it('runCommand should throw error', async () => {
      await expect(sandbox.runCommand('ls')).rejects.toThrow('requires SSH connection');
    });
  });

  // ==================== Raw Sandbox Tests ====================

  describe('getRawSandbox', () => {
    it('should return raw sandbox data', () => {
      const raw = sandbox.getRawSandbox();

      expect(raw.id).toBe('sandbox-123');
      expect(raw.name).toBe('test-sandbox');
      expect(raw.status).toBe('running');
      expect(raw.image).toBe('ubuntu:22.04');
    });
  });
});

// ==================== SDK Version Tests ====================

describe('SDK Version', () => {
  it('should export version', () => {
    const { VERSION } = require('../src');
    expect(VERSION).toBe('0.2.0');
  });
});

// ==================== waitForRunning Tests ====================

describe('waitForRunning', () => {
  let client: CodePodClient;
  let mock: MockAdapter;
  let axiosInstance: AxiosInstance;

  beforeEach(() => {
    axiosInstance = axios.create({
      baseURL: BASE_URL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
      },
    });

    client = new CodePodClient({ baseURL: BASE_URL, apiKey: API_KEY });
    (client as any).client = axiosInstance;
    mock = new MockAdapter(axiosInstance);
  });

  afterEach(() => {
    mock.restore();
  });

  it('should wait for sandbox to be running', async () => {
    const pendingSandbox = new Sandbox(client, {
      id: 'sandbox-pending',
      name: 'pending',
      status: 'pending' as SandboxStatus,
      image: 'ubuntu:22.04',
      host: 'localhost',
      port: 22,
      user: 'root',
      createdAt: '',
    });

    // First call returns pending
    mock.onGet('/api/v1/sandboxes/sandbox-pending').reply(200, {
      sandbox: {
        id: 'sandbox-pending',
        name: 'pending',
        status: 'pending',
        image: 'ubuntu:22.04',
        host: 'localhost',
        port: 22,
        user: 'root',
        createdAt: '',
      },
    });

    // Second call returns running
    mock.onGet('/api/v1/sandboxes/sandbox-pending').reply(200, {
      sandbox: {
        id: 'sandbox-pending',
        name: 'pending',
        status: 'running',
        image: 'ubuntu:22.04',
        host: 'localhost',
        port: 22345,
        user: 'root',
        createdAt: '',
      },
    });

    await pendingSandbox.waitForRunning(5, 100);

    expect(pendingSandbox.status).toBe('running');
    expect(pendingSandbox.port).toBe(22345);
  });

  it('should throw error on timeout', async () => {
    const pendingSandbox = new Sandbox(client, {
      id: 'sandbox-pending',
      name: 'pending',
      status: 'pending' as SandboxStatus,
      image: 'ubuntu:22.04',
      host: 'localhost',
      port: 22,
      user: 'root',
      createdAt: '',
    });

    // Always return pending
    mock.onGet('/api/v1/sandboxes/sandbox-pending').reply(200, {
      sandbox: {
        id: 'sandbox-pending',
        name: 'pending',
        status: 'pending',
        image: 'ubuntu:22.04',
        host: 'localhost',
        port: 22,
        user: 'root',
        createdAt: '',
      },
    });

    await expect(pendingSandbox.waitForRunning(1, 100)).rejects.toThrow('Timeout');
  });

  it('should throw error on failed status', async () => {
    const failedSandbox = new Sandbox(client, {
      id: 'sandbox-failed',
      name: 'failed',
      status: 'pending' as SandboxStatus,
      image: 'ubuntu:22.04',
      host: 'localhost',
      port: 22,
      user: 'root',
      createdAt: '',
    });

    mock.onGet('/api/v1/sandboxes/sandbox-failed').reply(200, {
      sandbox: {
        id: 'sandbox-failed',
        name: 'failed',
        status: 'failed',
        image: 'ubuntu:22.04',
        host: 'localhost',
        port: 22,
        user: 'root',
        createdAt: '',
      },
    });

    await expect(failedSandbox.waitForRunning(5, 100)).rejects.toThrow('failed');
  });
});

// ==================== Integration-like Tests ====================

describe('CodePodClient + Sandbox Integration', () => {
  let client: CodePodClient;
  let mock: MockAdapter;
  let axiosInstance: AxiosInstance;

  beforeEach(() => {
    axiosInstance = axios.create({
      baseURL: BASE_URL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
      },
    });

    client = new CodePodClient({ baseURL: BASE_URL, apiKey: API_KEY });
    (client as any).client = axiosInstance;
    mock = new MockAdapter(axiosInstance);
  });

  afterEach(() => {
    mock.restore();
  });

  it('should create sandbox and wrap in Sandbox class', async () => {
    const response = {
      sandbox: {
        id: 'sandbox-456',
        name: 'my-sandbox',
        status: 'pending',
        image: 'python:3.11',
        host: 'localhost',
        port: 22,
        user: 'root',
        createdAt: '2024-01-01T00:00:00Z',
      },
      sshHost: 'localhost',
      sshPort: 22,
      sshUser: 'root',
      token: 'secret-token',
    };
    mock.onPost('/api/v1/sandboxes').reply(201, response);

    const result = await client.createSandbox({ image: 'python:3.11' });
    const sandbox = new Sandbox(client, result.sandbox);

    expect(sandbox.id).toBe('sandbox-456');
    expect(sandbox.name).toBe('my-sandbox');
    expect(sandbox.status).toBe('pending');
  });

  it('should handle sandbox lifecycle', async () => {
    // Create
    mock.onPost('/api/v1/sandboxes').reply(201, {
      sandbox: { id: 'sandbox-789', name: 'test', status: 'running', image: 'ubuntu:22.04', host: 'localhost', port: 22, user: 'root', createdAt: '' },
      sshHost: 'localhost',
      sshPort: 22,
      sshUser: 'root',
      token: 'token',
    });

    // Get token
    mock.onPost('/api/v1/sandboxes/sandbox-789/token').reply(200, { token: 'new-token' });

    // Stop
    mock.onPost('/api/v1/sandboxes/sandbox-789/stop').reply(200);

    // Start with waitForRunning
    mock.onPost('/api/v1/sandboxes/sandbox-789/restart').reply(200);
    mock.onGet('/api/v1/sandboxes/sandbox-789').reply(200, {
      sandbox: { id: 'sandbox-789', name: 'test', status: 'running', image: 'ubuntu:22.04', host: 'localhost', port: 22, user: 'root', createdAt: '' },
    });

    // Delete
    mock.onDelete('/api/v1/sandboxes/sandbox-789').reply(200, { success: true });

    const createResult = await client.createSandbox({ image: 'ubuntu:22.04' });
    const sandbox = new Sandbox(client, createResult.sandbox);

    expect(sandbox.status).toBe('running');

    const token = await sandbox.getToken();
    expect(token).toBe('new-token');

    await sandbox.stop();
    await sandbox.start();
    await sandbox.delete();
  });

  it('should create sandbox and wait for running', async () => {
    // Create
    mock.onPost('/api/v1/sandboxes').reply(201, {
      sandbox: { id: 'sandbox-wait', name: 'test', status: 'pending', image: 'ubuntu:22.04', host: 'localhost', port: 0, user: 'root', createdAt: '' },
      sshHost: 'localhost',
      sshPort: 0,
      sshUser: 'root',
      token: 'token',
    });

    // First get returns pending
    mock.onGet('/api/v1/sandboxes/sandbox-wait').reply(200, {
      sandbox: { id: 'sandbox-wait', name: 'test', status: 'pending', image: 'ubuntu:22.04', host: 'localhost', port: 0, user: 'root', createdAt: '' },
    });

    // Second get returns running
    mock.onGet('/api/v1/sandboxes/sandbox-wait').reply(200, {
      sandbox: { id: 'sandbox-wait', name: 'test', status: 'running', image: 'ubuntu:22.04', host: 'localhost', port: 22345, user: 'root', createdAt: '' },
    });

    const sandbox = await client.createSandboxAndWait({ image: 'ubuntu:22.04' }, 10);

    expect(sandbox.status).toBe('running');
    expect(sandbox.port).toBe(22345);
  });
});
