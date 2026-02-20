/**
 * External Registry Service - Support for external container registries
 */

import { ExternalRegistry, ExternalRegistryType, AuthType } from '../types/registry';
import * as fs from 'fs';
import * as path from 'path';

const STORAGE_FILE = process.env.CODEPOD_REGISTRY_CONFIG || './data/registry/external.json';

interface RegistryConfig {
  registries: ExternalRegistry[];
}

export class ExternalRegistryService {
  private registries: Map<string, ExternalRegistry> = new Map();
  private configDir: string;

  constructor() {
    this.configDir = path.dirname(STORAGE_FILE);
    this.load();
  }

  /**
   * Load registry configurations from file
   */
  private load(): void {
    try {
      if (fs.existsSync(STORAGE_FILE)) {
        const content = fs.readFileSync(STORAGE_FILE, 'utf-8');
        const config: RegistryConfig = JSON.parse(content);
        for (const reg of config.registries) {
          this.registries.set(reg.id, reg);
        }
      }
    } catch (error) {
      // Ignore load errors
    }
  }

  /**
   * Save registry configurations to file
   */
  private save(): void {
    try {
      fs.mkdirSync(this.configDir, { recursive: true });
      const config: RegistryConfig = {
        registries: Array.from(this.registries.values()),
      };
      fs.writeFileSync(STORAGE_FILE, JSON.stringify(config, null, 2));
    } catch (error) {
      console.error('Failed to save external registry configs:', error);
    }
  }

  /**
   * Create Harbor registry configuration
   */
  createHarborConfig(endpoint: string, username: string, password: string): ExternalRegistry {
    const registry: ExternalRegistry = {
      id: `harbor-${Date.now()}`,
      name: `Harbor (${endpoint})`,
      type: 'harbor',
      endpoint: `https://${endpoint}`,
      auth: {
        type: 'basic',
        username,
        password: this.encryptPassword(password),
      },
      insecure: false,
      createdAt: new Date(),
    };
    this.registries.set(registry.id, registry);
    this.save();
    return registry;
  }

  /**
   * Create Docker Hub registry configuration
   */
  createDockerHubConfig(token?: string): ExternalRegistry {
    const registry: ExternalRegistry = {
      id: `dockerhub-${Date.now()}`,
      name: 'Docker Hub',
      type: 'dockerhub',
      endpoint: 'https://index.docker.io/v1/',
      auth: {
        type: 'bearer',
        registryToken: token,
      },
      insecure: false,
      createdAt: new Date(),
    };
    this.registries.set(registry.id, registry);
    this.save();
    return registry;
  }

  /**
   * Create ECR registry configuration
   */
  createECRConfig(region: string, accessKeyId?: string, secretAccessKey?: string): ExternalRegistry {
    const registry: ExternalRegistry = {
      id: `ecr-${Date.now()}`,
      name: `ECR (${region})`,
      type: 'ecr',
      endpoint: `${region}.dkr.ecr.${region}.amazonaws.com`,
      auth: {
        type: 'aws-iam',
        username: accessKeyId,
        password: secretAccessKey,
      },
      insecure: false,
      createdAt: new Date(),
    };
    this.registries.set(registry.id, registry);
    this.save();
    return registry;
  }

  /**
   * Create custom registry configuration
   */
  createCustomConfig(
    name: string,
    endpoint: string,
    authType: AuthType,
    username?: string,
    password?: string,
    insecure: boolean = false
  ): ExternalRegistry {
    const registry: ExternalRegistry = {
      id: `custom-${Date.now()}`,
      name,
      type: 'custom',
      endpoint,
      auth: {
        type: authType,
        username,
        password: password ? this.encryptPassword(password) : undefined,
      },
      insecure,
      createdAt: new Date(),
    };
    this.registries.set(registry.id, registry);
    this.save();
    return registry;
  }

  /**
   * Get all external registries
   */
  list(): ExternalRegistry[] {
    return Array.from(this.registries.values());
  }

  /**
   * Get registry by ID
   */
  get(id: string): ExternalRegistry | undefined {
    return this.registries.get(id);
  }

  /**
   * Delete registry by ID
   */
  delete(id: string): boolean {
    const deleted = this.registries.delete(id);
    if (deleted) {
      this.save();
    }
    return deleted;
  }

  /**
   * Test connection to external registry
   */
  async testConnection(registry: ExternalRegistry): Promise<boolean> {
    // TODO: Implement actual connection test
    // For now, just validate the configuration
    if (!registry.endpoint) {
      return false;
    }
    if (registry.auth.type === 'basic' && (!registry.auth.username || !registry.auth.password)) {
      return false;
    }
    return true;
  }

  /**
   * Clear all registries (for testing)
   */
  clear(): void {
    this.registries.clear();
  }

  /**
   * Pull image from external registry to local cache
   */
  async pullToLocal(registryId: string, image: string, tag: string): Promise<void> {
    // TODO: Implement using go-containerregistry or direct HTTP
    console.log(`Pulling ${image}:${tag} from registry ${registryId} to local cache`);
  }

  /**
   * Push image from local cache to external registry
   */
  async pushToExternal(registryId: string, image: string, tag: string): Promise<void> {
    // TODO: Implement
    console.log(`Pushing ${image}:${tag} to external registry ${registryId}`);
  }

  /**
   * Encrypt password (simple XOR for demo - use proper encryption in production)
   */
  private encryptPassword(password: string): string {
    const key = process.env.CODEPOD_ENCRYPTION_KEY || 'default-key-change-me';
    const buffer = Buffer.from(password);
    const keyBuffer = Buffer.from(key);

    const encrypted = Buffer.alloc(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      encrypted[i] = buffer[i] ^ keyBuffer[i % keyBuffer.length];
    }

    return encrypted.toString('base64');
  }

  /**
   * Decrypt password
   */
  private decryptPassword(encrypted: string): string {
    const key = process.env.CODEPOD_ENCRYPTION_KEY || 'default-key-change-me';
    const buffer = Buffer.from(encrypted, 'base64');
    const keyBuffer = Buffer.from(key);

    const decrypted = Buffer.alloc(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      decrypted[i] = buffer[i] ^ keyBuffer[i % keyBuffer.length];
    }

    return decrypted.toString();
  }
}

export const externalRegistryService = new ExternalRegistryService();
