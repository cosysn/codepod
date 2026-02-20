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

  getRegistry(): string {
    return this.load().registry;
  }
}

export const configManager = ConfigManager.getInstance();
