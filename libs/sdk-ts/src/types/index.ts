/**
 * CodePod TypeScript SDK - Types
 */

export type SandboxStatus = 'pending' | 'running' | 'stopped' | 'failed' | 'deleted' | 'deleting';

/**
 * Sandbox represents a sandbox instance
 */
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
  startedAt?: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
  agentInfo?: AgentInfo;
  runnerId?: string;
  containerId?: string;
}

/**
 * AgentInfo represents agent information
 */
export interface AgentInfo {
  lastHeartbeat: string;
  ipAddress?: string;
  hostname?: string;
  metrics?: AgentMetrics;
}

/**
 * AgentMetrics represents agent metrics
 */
export interface AgentMetrics {
  cpuPercent?: number;
  memoryMB?: number;
  sessionCount?: number;
}

/**
 * Resources represents resource allocation
 */
export interface Resources {
  cpu: number;
  memory: string;
  disk?: string;
}

/**
 * CreateSandboxRequest represents a request to create a sandbox
 */
export interface CreateSandboxRequest {
  name?: string;
  image: string;
  cpu?: number;
  memory?: string;
  env?: Record<string, string>;
  timeout?: number;
  volumes?: VolumeMount[];
}

/**
 * VolumeMount represents a volume mount
 */
export interface VolumeMount {
  volumeId: string;
  mountPath: string;
}

/**
 * CreateSandboxResponse represents the response after creating a sandbox
 */
export interface CreateSandboxResponse {
  sandbox: Sandbox;
  sshHost: string;
  sshPort: number;
  sshUser: string;
  token: string;
}

/**
 * SandboxListResponse represents a list of sandboxes
 */
export interface SandboxListResponse {
  sandboxes: Sandbox[];
  total: number;
}

/**
 * TokenResponse represents a token response
 */
export interface TokenResponse {
  token: string;
}

/**
 * SuccessResponse represents a generic success response
 */
export interface SuccessResponse {
  success: boolean;
}

/**
 * ErrorResponse represents an API error
 */
export interface ErrorResponse {
  code: number;
  message: string;
  details?: string;
}

/**
 * Volume represents a volume
 */
export interface Volume {
  id: string;
  name: string;
  size: string;
  hostPath?: string;
  createdAt: string;
}

/**
 * CreateVolumeRequest represents a request to create a volume
 */
export interface CreateVolumeRequest {
  name: string;
  size: string;
}

/**
 * CreateVolumeResponse represents the response after creating a volume
 */
export interface CreateVolumeResponse {
  volumeId: string;
  hostPath: string;
}

/**
 * APIKey represents an API key
 */
export interface APIKey {
  id: string;
  key: string;
  name?: string;
  createdAt: string;
  expiresAt?: string;
}

/**
 * CreateAPIKeyRequest represents a request to create an API key
 */
export interface CreateAPIKeyRequest {
  name?: string;
  expiresIn?: number;
}

/**
 * CreateAPIKeyResponse represents the response after creating an API key
 */
export interface CreateAPIKeyResponse {
  key: APIKey;
  rawKey: string;
}

/**
 * HealthResponse represents a health check response
 */
export interface HealthResponse {
  status: string;
  version?: string;
}

/**
 * StatsResponse represents server statistics
 */
export interface StatsResponse {
  totalSandboxes: number;
  runningSandboxes: number;
  cpuUsage: number;
  memoryUsage: number;
}

/**
 * ClientOptions represents client configuration options
 */
export interface ClientOptions {
  baseURL: string;
  apiKey?: string;
  timeout?: number;
}
