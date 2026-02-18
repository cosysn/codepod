/**
 * API Client
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { configManager } from './config';
import { Sandbox, CreateSandboxRequest, SandboxResponse, APIError } from './types';

export class APIClient {
  private client: AxiosInstance;

  constructor(endpoint?: string, apiKey?: string) {
    const config = configManager.load();
    const baseURL = endpoint || config.endpoint;
    const key = apiKey || config.apiKey;

    this.client = axios.create({
      baseURL,
      headers: key ? { 'Authorization': `Bearer ${key}` } : {},
    });
  }

  /**
   * Create a new sandbox
   */
  async createSandbox(req: CreateSandboxRequest): Promise<SandboxResponse> {
    const response = await this.client.post<SandboxResponse>('/api/v1/sandboxes', req);
    return response.data;
  }

  /**
   * Get a sandbox by ID
   */
  async getSandbox(id: string): Promise<Sandbox> {
    const response = await this.client.get<Sandbox>(`/api/v1/sandboxes/${id}`);
    return response.data;
  }

  /**
   * List all sandboxes
   */
  async listSandboxes(): Promise<Sandbox[]> {
    const response = await this.client.get<{ sandboxes: Sandbox[] }>('/api/v1/sandboxes');
    return response.data.sandboxes;
  }

  /**
   * Delete a sandbox
   */
  async deleteSandbox(id: string): Promise<void> {
    await this.client.delete(`/api/v1/sandboxes/${id}`);
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
  async getToken(id: string): Promise<string> {
    const response = await this.client.post<{ token: string }>(`/api/v1/sandboxes/${id}/token`);
    return response.data.token;
  }

  /**
   * Handle API error
   */
  static handleError(error: unknown): APIError {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<APIError>;
      if (axiosError.response?.data && typeof axiosError.response.data === 'object') {
        const data = axiosError.response.data as any;
        return {
          code: data.code || axiosError.response?.status || 500,
          message: data.message || axiosError.message,
          details: data.details,
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
