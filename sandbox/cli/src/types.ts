/**
 * CLI Types
 */

export type SandboxStatus = 'pending' | 'running' | 'stopped' | 'failed' | 'deleted';

export interface Sandbox {
  id: string;
  name: string;
  status: SandboxStatus;
  image: string;
  host: string;
  port: number;
  user: string;
  token?: string;
  sshPort?: number;
  createdAt: string;
  startedAt?: string;
}

export interface CreateSandboxRequest {
  name?: string;
  image: string;
  cpu?: number;
  memory?: string;
  env?: Record<string, string>;
  timeout?: number;
}

export interface SandboxResponse {
  sandbox: Sandbox;
  sshHost: string;
  sshPort: number;
  sshUser: string;
  token: string;
}

export interface Config {
  endpoint: string;
  apiKey: string;
  output: 'json' | 'table' | 'simple';
}

export interface APIError {
  code: number;
  message: string;
  details?: string;
}
