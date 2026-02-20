// apps/devpod/src/image/types.ts

export interface ResolvedImage {
  originalName: string;
  fullName: string;
  registry: string;
  repository: string;
  tag: string;
  digest?: string;
  useCache: boolean;
}

export interface RegistryConfig {
  name: string;
  endpoint: string;
  insecure: boolean;
  priority: number;
}

export interface ImageResolverConfig {
  preferCache: boolean;
  cacheRegistry: string;
  fallbackRegistries: string[];
  prefixMappings: Record<string, string>;
}
