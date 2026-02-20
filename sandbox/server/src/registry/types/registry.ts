/**
 * Registry type definitions for OCI Image Manifest and Docker Registry V2
 */

/**
 * Image represents a container image repository
 */
export interface Image {
  name: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  size: number;
  manifest?: Manifest;
}

/**
 * Tag represents a specific tag of an image
 */
export interface Tag {
  name: string;
  digest: string;
  createdAt: Date;
  size: number;
  architecture: string;
  os: string;
  layers: number;
}

/**
 * Manifest represents an OCI Image Manifest
 * See: https://github.com/opencontainers/image-spec/blob/main/manifest.md
 */
export interface Manifest {
  schemaVersion: number;
  mediaType: string;
  config: {
    mediaType: string;
    digest: string;
    size: number;
  };
  layers: Array<{
    mediaType: string;
    digest: string;
    size: number;
    urls?: string[];
  }>;
  annotations?: Record<string, string>;
}

/**
 * ImageIndex represents an OCI Image Index (Manifest List)
 * See: https://github.com/opencontainers/image-spec/blob/main/image-index.md
 */
export interface ImageIndex {
  schemaVersion: number;
  mediaType: string;
  manifests: Array<{
    mediaType: string;
    digest: string;
    size: number;
    annotations?: Record<string, string>;
  }>;
  annotations?: Record<string, string>;
}

/**
 * ExternalRegistryType represents supported external registry types
 */
export type ExternalRegistryType = 'harbor' | 'ecr' | 'dockerhub' | 'gcr' | 'acr' | 'custom';

/**
 * AuthType represents authentication type
 */
export type AuthType = 'basic' | 'bearer' | 'aws-iam' | 'gcp-iam';

/**
 * ExternalRegistry represents configuration for an external container registry
 */
export interface ExternalRegistry {
  id: string;
  name: string;
  type: ExternalRegistryType;
  endpoint: string;
  auth: {
    type: AuthType;
    username?: string;
    password?: string;
    registryToken?: string;
  };
  insecure: boolean;
  createdAt: Date;
}

/**
 * BlobInfo represents blob metadata
 */
export interface BlobInfo {
  digest: string;
  size: number;
  createdAt: Date;
}

/**
 * RepositoryInfo represents repository metadata
 */
export interface RepositoryInfo {
  name: string;
  tags: string[];
  manifest?: Manifest;
  blobCount: number;
  totalSize: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * UploadInfo represents an ongoing blob upload session
 */
export interface UploadInfo {
  id: string;
  repository: string;
  digest?: string;
  size: number;
  uploaded: number;
  startedAt: Date;
}
