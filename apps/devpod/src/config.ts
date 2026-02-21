import * as fs from 'fs';
import * as path from 'path';

const CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '/root', '.devpod');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export interface DevPodConfig {
  endpoint: string;
  registry: string;
}

const defaultConfig: DevPodConfig = {
  endpoint: '',
  registry: 'localhost:5000',
};

function isDevPodConfig(obj: unknown): obj is DevPodConfig {
  if (obj && typeof obj === 'object') {
    const cfg = obj as Record<string, unknown>;
    return typeof cfg.endpoint === 'string' && typeof cfg.registry === 'string';
  }
  return false;
}

export class ConfigManager {
  private static instance: ConfigManager;

  private constructor() {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
  }

  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  load(): DevPodConfig {
    try {
      const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (isDevPodConfig(parsed)) {
        return parsed;
      }
      console.warn('Invalid config format, using defaults');
      return { ...defaultConfig };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('Failed to load config:', error);
      }
      return { ...defaultConfig };
    }
  }

  save(config: DevPodConfig): void {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  }

  getEndpoint(): string {
    return this.load().endpoint;
  }

  /**
   * 从 Server endpoint 推导内置 registry 地址
   * 例如: http://localhost:8080 → localhost:8080/registry/v2
   */
  getRegistryFromEndpoint(endpoint: string): string {
    try {
      const url = new URL(endpoint);
      const host = url.hostname;
      const port = url.port || (url.protocol === 'https:' ? '443' : '80');
      return `${host}:${port}/registry/v2`;
    } catch {
      return 'localhost:8080/registry/v2';
    }
  }

  /**
   * 获取 registry 地址，优先使用配置的 registry，否则从 endpoint 推导
   */
  getRegistry(): string {
    const cfg = this.load();
    if (cfg.registry && cfg.registry !== 'localhost:5000') {
      return cfg.registry;
    }
    if (cfg.endpoint) {
      return this.getRegistryFromEndpoint(cfg.endpoint);
    }
    return 'localhost:8080/registry/v2';
  }
}

export const configManager = ConfigManager.getInstance();
