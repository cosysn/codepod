/**
 * CodePod TypeScript SDK - Client
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import {
  Sandbox,
  CreateSandboxRequest,
  CreateSandboxResponse,
  SandboxListResponse,
  TokenResponse,
  SuccessResponse,
  ErrorResponse,
  Volume,
  CreateVolumeRequest,
  CreateVolumeResponse,
  APIKey,
  CreateAPIKeyRequest,
  CreateAPIKeyResponse,
  HealthResponse,
  StatsResponse,
  ClientOptions,
} from '../types';

export { ErrorResponse } from '../types';

/**
 * CodePod API Client
 */
export class CodePodClient {
  private client: AxiosInstance;

  /**
   * Create a new CodePod client
   */
  constructor(options: ClientOptions) {
    this.client = axios.create({
      baseURL: options.baseURL,
      timeout: options.timeout || 30000,
      headers: {
        'Content-Type': 'application/json',
        ...(options.apiKey && { 'X-API-Key': options.apiKey }),
      },
    });
  }

  /**
   * Set the API key for requests
   */
  setAPIKey(apiKey: string): void {
    this.client.defaults.headers['X-API-Key'] = apiKey;
  }

  // ==================== Health ====================

  /**
   * Check server health
   */
  async health(): Promise<HealthResponse> {
    const response = await this.client.get<HealthResponse>('/health');
    return response.data;
  }

  // ==================== Sandboxes ====================

  /**
   * Create a new sandbox
   */
  async createSandbox(request: CreateSandboxRequest): Promise<CreateSandboxResponse> {
    const response = await this.client.post<CreateSandboxResponse>('/api/v1/sandboxes', request);
    return response.data;
  }

  /**
   * Get a sandbox by ID
   */
  async getSandbox(id: string): Promise<Sandbox> {
    const response = await this.client.get<{ sandbox: Sandbox }>(`/api/v1/sandboxes/${id}`);
    return response.data.sandbox;
  }

  /**
   * List all sandboxes
   */
  async listSandboxes(): Promise<SandboxListResponse> {
    const response = await this.client.get<SandboxListResponse>('/api/v1/sandboxes');
    return response.data;
  }

  /**
   * Delete a sandbox
   */
  async deleteSandbox(id: string): Promise<SuccessResponse> {
    const response = await this.client.delete<SuccessResponse>(`/api/v1/sandboxes/${id}`);
    return response.data;
  }

  /**
   * Stop a sandbox
   */
  async stopSandbox(id: string): Promise<void> {
    await this.client.post(`/api/v1/sandboxes/${id}/stop`);
  }

  /**
   * Restart a sandbox
   */
  async restartSandbox(id: string): Promise<void> {
    await this.client.post(`/api/v1/sandboxes/${id}/restart`);
  }

  /**
   * Get SSH token for a sandbox
   */
  async getSandboxToken(id: string): Promise<TokenResponse> {
    const response = await this.client.post<TokenResponse>(`/api/v1/sandboxes/${id}/token`);
    return response.data;
  }

  /**
   * Update sandbox status
   */
  async updateSandboxStatus(
    id: string,
    status: string,
    metrics?: { cpuPercent?: number; memoryMB?: number; sessionCount?: number }
  ): Promise<SuccessResponse> {
    const response = await this.client.post<SuccessResponse>(`/api/v1/sandboxes/${id}/status`, {
      status,
      ...metrics,
    });
    return response.data;
  }

  // ==================== Volumes ====================

  /**
   * Create a new volume
   */
  async createVolume(request: CreateVolumeRequest): Promise<CreateVolumeResponse> {
    const response = await this.client.post<CreateVolumeResponse>('/api/v1/volumes', request);
    return response.data;
  }

  /**
   * Get a volume by ID
   */
  async getVolume(id: string): Promise<Volume> {
    const response = await this.client.get<{ volume: Volume }>(`/api/v1/volumes/${id}`);
    return response.data.volume;
  }

  /**
   * List all volumes
   */
  async listVolumes(): Promise<{ volumes: Volume[] }> {
    const response = await this.client.get<{ volumes: Volume[] }>('/api/v1/volumes');
    return response.data;
  }

  /**
   * Delete a volume
   */
  async deleteVolume(id: string): Promise<SuccessResponse> {
    const response = await this.client.delete<SuccessResponse>(`/api/v1/volumes/${id}`);
    return response.data;
  }

  // ==================== API Keys ====================

  /**
   * Create an API key
   */
  async createAPIKey(request: CreateAPIKeyRequest): Promise<CreateAPIKeyResponse> {
    const response = await this.client.post<CreateAPIKeyResponse>('/api/v1/keys', request);
    return response.data;
  }

  /**
   * List all API keys
   */
  async listAPIKeys(): Promise<{ keys: APIKey[] }> {
    const response = await this.client.get<{ keys: APIKey[] }>('/api/v1/keys');
    return response.data;
  }

  /**
   * Delete an API key
   */
  async deleteAPIKey(id: string): Promise<SuccessResponse> {
    const response = await this.client.delete<SuccessResponse>(`/api/v1/keys/${id}`);
    return response.data;
  }

  // ==================== Statistics ====================

  /**
   * Get server statistics
   */
  async getStats(): Promise<StatsResponse> {
    const response = await this.client.get<StatsResponse>('/api/v1/stats');
    return response.data;
  }

  // ==================== Error Handling ====================

  /**
   * Handle API error and return structured error
   */
  static handleError(error: unknown): ErrorResponse {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<ErrorResponse>;
      if (axiosError.response?.data) {
        return {
          code: axiosError.response.data.code || axiosError.response.status || 500,
          message: axiosError.response.data.message || axiosError.message,
          details: axiosError.response.data.details,
        };
      }
      return {
        code: axiosError.response?.status || 500,
        message: axiosError.message,
      };
    }
    return {
      code: 500,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export default CodePodClient;
