/**
 * Core types for CodePod Server
 */

export type SandboxStatus = 'pending' | 'running' | 'stopped' | 'failed' | 'deleted';

export interface AgentInfo {
  lastHeartbeat: string; // ISO timestamp
  ipAddress?: string;
  hostname?: string;
  metrics?: {
    cpuPercent?: number;
    memoryMB?: number;
    sessionCount?: number;
  };
}

export interface Sandbox {
  id: string;
  name: string;
  status: SandboxStatus;
  image: string;
  host: string;
  port: number;
  user: string;
  token?: string;
  createdAt: Date;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
  agentInfo?: AgentInfo;
  runnerId?: string;
  containerId?: string;
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

export interface SandboxListItem {
  id: string;
  name: string;
  status: SandboxStatus;
  image: string;
  host: string;
  port: number;
  createdAt: string;
  startedAt?: string;
}

export interface ErrorResponse {
  code: number;
  message: string;
  details?: string;
}

export interface ServerConfig {
  port: number;
  host: string;
  logLevel: string;
  dataDir: string;
}

export interface APIKey {
  id: string;
  key: string;
  name: string;
  createdAt: Date;
  expiresAt?: Date;
  lastUsedAt?: Date;
}

export interface AuditLog {
  id: string;
  action: string;
  resource: string;
  resourceId?: string;
  userId?: string;
  details?: Record<string, unknown>;
  timestamp: Date;
}
