/**
 * API Client Tests
 */

import axios from 'axios';
import { APIClient } from './api';
import { configManager } from './config';
import { APIError, Sandbox } from './types';

// Mock axios
jest.mock('axios', () => ({
  create: jest.fn(),
  isAxiosError: jest.fn((error) => error?.isAxiosError === true),
}));

jest.mock('./config');

describe('APIClient', () => {
  const mockConfig = configManager as jest.Mocked<typeof configManager>;
  const mockAxiosIsAxiosError = (axios.isAxiosError as unknown) as jest.Mock;

  beforeEach(() => {
    jest.resetAllMocks();
    mockConfig.load.mockReturnValue({
      endpoint: 'http://localhost:8080',
      apiKey: '',
      output: 'table',
    });
  });

  describe('createSandbox', () => {
    it('should create a sandbox', async () => {
      const mockResponse = {
        data: {
          sandbox: {
            id: '123',
            name: 'test',
            status: 'pending' as const,
            image: 'ubuntu:20.04',
            host: 'localhost',
            port: 2222,
            user: 'root',
            createdAt: new Date().toISOString(),
          },
          sshHost: 'localhost',
          sshPort: 2222,
          sshUser: 'root',
          token: 'test-token',
        },
      };

      (axios.create as jest.Mock).mockReturnValue({
        post: jest.fn().mockResolvedValue(mockResponse),
      });

      const client = new APIClient();
      const result = await client.createSandbox({ image: 'ubuntu:20.04' });

      expect(result.sandbox.name).toBe('test');
      expect(result.token).toBe('test-token');
    });
  });

  describe('getSandbox', () => {
    it('should get a sandbox by id', async () => {
      const mockResponse = {
        data: {
          id: '123',
          name: 'test',
          status: 'running' as const,
          image: 'ubuntu:20.04',
          host: 'localhost',
          port: 2222,
          user: 'root',
          createdAt: new Date().toISOString(),
        },
      };

      (axios.create as jest.Mock).mockReturnValue({
        get: jest.fn().mockResolvedValue(mockResponse),
      });

      const client = new APIClient();
      const result = await client.getSandbox('123');

      expect(result.id).toBe('123');
      expect(result.name).toBe('test');
    });
  });

  describe('listSandboxes', () => {
    it('should list all sandboxes', async () => {
      const mockResponse = {
        data: {
          sandboxes: [
            { id: '1', name: 'sandbox-1', status: 'running' as const, image: 'ubuntu', host: 'localhost', port: 2222, user: 'root', createdAt: new Date().toISOString() },
            { id: '2', name: 'sandbox-2', status: 'stopped' as const, image: 'alpine', host: 'localhost', port: 2223, user: 'root', createdAt: new Date().toISOString() },
          ],
        },
      };

      (axios.create as jest.Mock).mockReturnValue({
        get: jest.fn().mockResolvedValue(mockResponse),
      });

      const client = new APIClient();
      const result = await client.listSandboxes();

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('sandbox-1');
      expect(result[1].name).toBe('sandbox-2');
    });
  });

  describe('deleteSandbox', () => {
    it('should delete a sandbox', async () => {
      (axios.create as jest.Mock).mockReturnValue({
        delete: jest.fn().mockResolvedValue({}),
      });

      const client = new APIClient();
      await client.deleteSandbox('123');

      expect(axios.create).toHaveBeenCalled();
    });
  });

  describe('getToken', () => {
    it('should get SSH token', async () => {
      const mockResponse = {
        data: { token: 'test-token-123' },
      };

      (axios.create as jest.Mock).mockReturnValue({
        post: jest.fn().mockResolvedValue(mockResponse),
      });

      const client = new APIClient();
      const result = await client.getToken('123');

      expect(result).toBe('test-token-123');
    });
  });

  describe('handleError', () => {
    it('should handle axios error with response data', () => {
      mockAxiosIsAxiosError.mockReturnValue(true);

      const mockError = {
        isAxiosError: true,
        message: 'Request failed',
        response: {
          status: 404,
          data: { code: 404, message: 'Not found', details: 'Sandbox not found' },
        },
      };

      const result = APIClient.handleError(mockError);

      expect(result.code).toBe(404);
      expect(result.message).toBe('Not found');
      expect(result.details).toBe('Sandbox not found');
    });

    it('should handle axios error without data', () => {
      mockAxiosIsAxiosError.mockReturnValue(true);

      const mockError = {
        isAxiosError: true,
        message: 'Network error',
        response: {
          status: 500,
          data: undefined,
        },
      };

      const result = APIClient.handleError(mockError);

      expect(result.code).toBe(500);
      expect(result.message).toBe('Network error');
    });

    it('should handle non-axios error', () => {
      mockAxiosIsAxiosError.mockReturnValue(false);

      const result = APIClient.handleError(new Error('Unknown error'));

      expect(result.code).toBe(500);
      expect(result.message).toBe('Unknown error');
    });

    it('should handle unknown error', () => {
      mockAxiosIsAxiosError.mockReturnValue(false);

      const result = APIClient.handleError('unknown');

      expect(result.code).toBe(500);
      expect(result.message).toBe('Unknown error');
    });
  });
});
