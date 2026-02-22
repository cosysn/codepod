/**
 * Core types for CodePod Server
 */

export type SandboxStatus = 'pending' | 'running' | 'stopped' | 'failed' | 'deleted' | 'deleting';

export interface AgentInfo {
  lastHeartbeat: string; // ISO timestamp
  ipAddress?: string;
  hostname?: string;
  metrics?: {
    cpuPercent?: number;
    memoryMB?: number;
    sessionCount?: number;
  };
  // Agent gRPC address (from runner)
  address?: string;
  addressHost?: string;
  addressPort?: number;
  addressToken?: string;
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

// Volume types
export type VolumeStatus = 'available' | 'in-use' | 'deleting';

export interface Volume {
  id: string;
  name: string;
  status: VolumeStatus;
  size: string;
  hostPath?: string;
  createdAt: Date;
}

export interface CreateVolumeRequest {
  name: string;
  size?: string; // e.g., "10Gi", defaults to "10Gi"
}

export interface CreateVolumeResponse {
  volumeId: string;
  hostPath: string;
}
