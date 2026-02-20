// Sandbox types
export type SandboxStatus = 'pending' | 'running' | 'stopped' | 'deleted';

export interface AgentInfo {
  lastHeartbeat?: string;
  uptime?: number;
  loadAverage?: number[];
  memoryUsage?: {
    used: number;
    total: number;
  };
  cpuUsage?: number;
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
  createdAt: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
  agentInfo?: AgentInfo;
  runnerId?: string;
  containerId?: string;
}

export interface CreateSandboxRequest {
  name: string;
  image: string;
  host?: string;
  user?: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

// API Key types
export interface APIKey {
  id: string;
  key: string;
  name: string;
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
}

// Audit Log types
export interface AuditLog {
  id: string;
  action: string;
  resource: string;
  resourceId?: string;
  userId?: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

// Job types
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface Job {
  id: string;
  type: string;
  sandboxId: string;
  image: string;
  status: JobStatus;
  runnerId?: string;
  createdAt: string;
  env?: Record<string, string>;
  memory?: string;
  cpu?: number;
  networkMode?: string;
}

export interface CreateJobRequest {
  type: string;
  sandboxId: string;
  image: string;
  env?: Record<string, string>;
  memory?: string;
  cpu?: number;
  networkMode?: string;
}
