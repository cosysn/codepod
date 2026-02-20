import * as fs from 'fs';
import * as path from 'path';

const CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '/root', '.devpod');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export interface DevPodConfig {
  endpoint: string;
  registry: string;
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
      return JSON.parse(data);
    } catch {
      return { endpoint: '', registry: '' };
    }
  }

  save(config: DevPodConfig): void {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  }

  getEndpoint(): string {
    const cfg = this.load();
    return cfg.endpoint;
  }

  getRegistry(): string {
    const cfg = this.load();
    return cfg.registry || 'localhost:5000';
  }
}

export const configManager = ConfigManager.getInstance();
