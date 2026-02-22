/**
 * CodePod SDK Commands Tests
 */

import axios, { AxiosInstance } from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { CodePodClient, Sandbox, SandboxStatus } from '../src';

// Test constants
const BASE_URL = 'http://localhost:8080';
const API_KEY = 'test-api-key';

// Mock gRPC module
const mockGrpcClient = {
  waitForReady: jest.fn(),
  makeServerStreamRequest: jest.fn(),
  close: jest.fn(),
};

jest.mock('@grpc/grpc-js', () => ({
  credentials: {
    createInsecure: jest.fn(() => ({})),
  },
  Metadata: jest.fn().mockImplementation(() => ({
    add: jest.fn(),
  })),
  Client: jest.fn().mockImplementation(() => mockGrpcClient),
}));

// Type for mock gRPC call
type MockCallType = {
  on: jest.Mock;
  removeAllListeners: jest.Mock;
  cancel: jest.Mock;
};

describe('Sandbox.commands', () => {
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

    // Reset mock
    jest.clearAllMocks();
  });

  afterEach(() => {
    mock.restore();
  });

  // ==================== getConnectionInfo Tests ====================

  describe('getConnectionInfo', () => {
    it('should return connection info from server', async () => {
      const connectionInfo = {
        host: 'localhost',
        port: 50051,
        token: 'grpc-token-123',
      };
      mock.onGet('/api/v1/sandboxes/sandbox-123/connection').reply(200, connectionInfo);

      const result = await client.getConnectionInfo('sandbox-123');

      expect(result).toEqual(connectionInfo);
      expect(result.host).toBe('localhost');
      expect(result.port).toBe(50051);
      expect(result.token).toBe('grpc-token-123');
    });
  });

  // ==================== commands.run Tests ====================

  describe('commands.run', () => {
    beforeEach(() => {
      // Mock gRPC connection info endpoint
      mock.onGet('/api/v1/sandboxes/sandbox-123/connection').reply(200, {
        host: 'localhost',
        port: 50051,
        token: 'grpc-token-123',
      });

      // Mock gRPC client ready
      mockGrpcClient.waitForReady.mockImplementation((_, callback) => {
        callback(null);
      });
    });

    it('should run command and return result', async () => {
      const mockCall: MockCallType = {
        on: jest.fn((event, callback) => {
          if (event === 'data') {
            // Simulate streaming output
            callback({ line: 'Hello ', channel: 0 });
            callback({ line: 'World\n', channel: 0 });
            callback({ exitCode: 0 });
          }
          if (event === 'end') {
            callback();
          }
          return mockCall;
        }),
        removeAllListeners: jest.fn(),
        cancel: jest.fn(),
      };

      mockGrpcClient.makeServerStreamRequest.mockReturnValue(mockCall);

      const result = await sandbox.commands.run('echo "Hello World"');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('Hello World\n');
      expect(result.stderr).toBe('');
      expect(result.timedOut).toBe(false);
    });

    it('should handle stderr output', async () => {
      const mockCall: MockCallType = {
        on: jest.fn((event, callback) => {
          if (event === 'data') {
            callback({ line: 'Error message\n', channel: 1 });
            callback({ exitCode: 1 });
          }
          if (event === 'end') {
            callback();
          }
          return mockCall;
        }),
        removeAllListeners: jest.fn(),
        cancel: jest.fn(),
      };

      mockGrpcClient.makeServerStreamRequest.mockReturnValue(mockCall);

      const result = await sandbox.commands.run('echo "Error message" >&2; exit 1');

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('Error message\n');
    });

    it('should call onStdout callback', async () => {
      const onStdout = jest.fn();

      const mockCall: MockCallType = {
        on: jest.fn((event, callback) => {
          if (event === 'data') {
            callback({ line: 'Line 1\n', channel: 0 });
            callback({ line: 'Line 2\n', channel: 0 });
            callback({ exitCode: 0 });
          }
          if (event === 'end') {
            callback();
          }
          return mockCall;
        }),
        removeAllListeners: jest.fn(),
        cancel: jest.fn(),
      };

      mockGrpcClient.makeServerStreamRequest.mockReturnValue(mockCall);

      await sandbox.commands.run('echo -e "Line 1\nLine 2"', { onStdout });

      expect(onStdout).toHaveBeenCalledTimes(2);
      expect(onStdout).toHaveBeenCalledWith('Line 1\n');
      expect(onStdout).toHaveBeenCalledWith('Line 2\n');
    });

    it('should call onStderr callback', async () => {
      const onStderr = jest.fn();

      const mockCall: MockCallType = {
        on: jest.fn((event, callback) => {
          if (event === 'data') {
            callback({ line: 'Error 1\n', channel: 1 });
            callback({ line: 'Error 2\n', channel: 1 });
            callback({ exitCode: 1 });
          }
          if (event === 'end') {
            callback();
          }
          return mockCall;
        }),
        removeAllListeners: jest.fn(),
        cancel: jest.fn(),
      };

      mockGrpcClient.makeServerStreamRequest.mockReturnValue(mockCall);

      await sandbox.commands.run('echo "Error 1" >&2; echo "Error 2" >&2; exit 1', { onStderr });

      expect(onStderr).toHaveBeenCalledTimes(2);
      expect(onStderr).toHaveBeenCalledWith('Error 1\n');
      expect(onStderr).toHaveBeenCalledWith('Error 2\n');
    });

    it('should handle gRPC error', async () => {
      const mockCall: MockCallType = {
        on: jest.fn((event, callback) => {
          if (event === 'error') {
            callback(new Error('Connection refused'));
          }
          return mockCall;
        }),
        removeAllListeners: jest.fn(),
        cancel: jest.fn(),
      };

      mockGrpcClient.makeServerStreamRequest.mockReturnValue(mockCall);

      await expect(sandbox.commands.run('ls')).rejects.toThrow('Connection refused');
    });

    it('should use custom timeout option', async () => {
      // Verify that timeout option is passed correctly in the request
      const mockCall: MockCallType = {
        on: jest.fn((event, callback) => {
          if (event === 'data') {
            callback({ exitCode: 0 });
          }
          if (event === 'end') {
            callback();
          }
          return mockCall;
        }),
        removeAllListeners: jest.fn(),
        cancel: jest.fn(),
      };

      mockGrpcClient.makeServerStreamRequest.mockReturnValue(mockCall);

      const result = await sandbox.commands.run('sleep 10', { timeout: 5000 });

      // When command completes before timeout, timedOut should be false
      expect(result.timedOut).toBe(false);
      expect(result.exitCode).toBe(0);

      // Verify timeout was set in the request
      const callArgs = mockGrpcClient.makeServerStreamRequest.mock.calls[0];
      const request = callArgs[3];
      expect(request.timeout).toBe(5000);
    });

    it('should pass cwd option to request', async () => {
      const mockCall: MockCallType = {
        on: jest.fn((event, callback) => {
          if (event === 'data') {
            callback({ exitCode: 0 });
          }
          if (event === 'end') {
            callback();
          }
          return mockCall;
        }),
        removeAllListeners: jest.fn(),
        cancel: jest.fn(),
      };

      mockGrpcClient.makeServerStreamRequest.mockReturnValue(mockCall);

      await sandbox.commands.run('pwd', { cwd: '/workspace' });

      // Verify the request was made
      expect(mockGrpcClient.makeServerStreamRequest).toHaveBeenCalled();
      const callArgs = mockGrpcClient.makeServerStreamRequest.mock.calls[0];
      const request = callArgs[3]; // The 4th argument is the request object

      expect(request).toBeDefined();
      expect(request.cwd).toBe('/workspace');
    });

    it('should pass env variables to request', async () => {
      const mockCall: MockCallType = {
        on: jest.fn((event, callback) => {
          if (event === 'data') {
            callback({ exitCode: 0 });
          }
          if (event === 'end') {
            callback();
          }
          return mockCall;
        }),
        removeAllListeners: jest.fn(),
        cancel: jest.fn(),
      };

      mockGrpcClient.makeServerStreamRequest.mockReturnValue(mockCall);

      const envVars = { MY_VAR: 'test-value', DEBUG: 'true' };
      await sandbox.commands.run('env', { env: envVars });

      const callArgs = mockGrpcClient.makeServerStreamRequest.mock.calls[0];
      const request = callArgs[3];

      expect(request.env).toBeDefined();
      expect(request.env?.MY_VAR).toBe('test-value');
      expect(request.env?.DEBUG).toBe('true');
    });

    it('should handle mixed stdout and stderr', async () => {
      const onStdout = jest.fn();
      const onStderr = jest.fn();

      const mockCall: MockCallType = {
        on: jest.fn((event, callback) => {
          if (event === 'data') {
            callback({ line: 'Output 1\n', channel: 0 });
            callback({ line: 'Error 1\n', channel: 1 });
            callback({ line: 'Output 2\n', channel: 0 });
            callback({ exitCode: 0 });
          }
          if (event === 'end') {
            callback();
          }
          return mockCall;
        }),
        removeAllListeners: jest.fn(),
        cancel: jest.fn(),
      };

      mockGrpcClient.makeServerStreamRequest.mockReturnValue(mockCall);

      const result = await sandbox.commands.run('echo test', {
        onStdout,
        onStderr,
      });

      expect(result.stdout).toBe('Output 1\nOutput 2\n');
      expect(result.stderr).toBe('Error 1\n');
      expect(onStdout).toHaveBeenCalledTimes(2);
      expect(onStderr).toHaveBeenCalledTimes(1);
    });

    it('should reuse gRPC client on subsequent calls', async () => {
      const mockCall: MockCallType = {
        on: jest.fn((event, callback) => {
          if (event === 'data') {
            callback({ exitCode: 0 });
          }
          if (event === 'end') {
            callback();
          }
          return mockCall;
        }),
        removeAllListeners: jest.fn(),
        cancel: jest.fn(),
      };

      mockGrpcClient.makeServerStreamRequest.mockReturnValue(mockCall);

      // First call
      await sandbox.commands.run('echo first');

      // Second call - should reuse the gRPC client
      await sandbox.commands.run('echo second');

      // waitForReady should only be called once (first call)
      expect(mockGrpcClient.waitForReady).toHaveBeenCalledTimes(1);
    });
  });

  // ==================== Commands Properties Tests ====================

  describe('commands property', () => {
    it('should return Commands instance', () => {
      const commands = sandbox.commands;
      expect(commands).toBeDefined();
      expect(typeof commands.run).toBe('function');
    });
  });
});
