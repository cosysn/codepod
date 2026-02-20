export type SandboxStatus = 'pending' | 'running' | 'stopped' | 'failed' | 'deleted' | 'deleting';

export interface Sandbox {
  id: string;
  name: string;
  status: SandboxStatus;
  image: string;
  host: string;
  port: number;
  user: string;
  token?: string;
  createdAt?: string;
}

export interface Volume {
  id: string;
  name: string;
  size: string;
  hostPath: string;
}

export interface CreateSandboxRequest {
  name: string;
  image: string;
  cpu?: number;
  memory?: string;
  volumes?: Array<{
    volumeId: string;
    mountPath: string;
  }>;
}

export interface CreateVolumeRequest {
  name: string;
  size: string;
}

export interface WorkspaceMeta {
  name: string;
  id: string;
  createdAt: string;
  status: 'pending' | 'building' | 'running' | 'stopped';
  devSandboxId?: string;
  builderSandboxId?: string;
  volumeId?: string;
  imageRef?: string;
  gitUrl?: string;
}
