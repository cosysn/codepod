/**
 * Configuration Manager
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Config } from './types';

const CONFIG_DIR = '.codepod';
const CONFIG_FILE = 'config.json';

export class ConfigManager {
  private configPath: string;

  constructor() {
    this.configPath = path.join(os.homedir(), CONFIG_DIR, CONFIG_FILE);
  }

  /**
   * Load configuration
   */
  load(): Config {
    const defaultConfig: Config = {
      endpoint: 'http://localhost:8080',
      apiKey: '',
      output: 'table',
    };

    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf8');
        const config = JSON.parse(content);
        return {
          endpoint: config.endpoint || defaultConfig.endpoint,
          apiKey: config.apiKey || '',
          output: config.output || defaultConfig.output,
        };
      }
    } catch (e) {
      // Ignore config errors
    }

    return defaultConfig;
  }

  /**
   * Save configuration
   */
  save(config: Config): void {
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
  }

  /**
   * Get endpoint
   */
  getEndpoint(): string {
    return this.load().endpoint;
  }

  /**
   * Get API key
   */
  getAPIKey(): string {
    return this.load().apiKey;
  }

  /**
   * Set endpoint
   */
  setEndpoint(endpoint: string): void {
    const config = this.load();
    config.endpoint = endpoint;
    this.save(config);
  }

  /**
   * Set API key
   */
  setAPIKey(apiKey: string): void {
    const config = this.load();
    config.apiKey = apiKey;
    this.save(config);
  }

  /**
   * Set output format
   */
  setOutput(output: 'json' | 'table' | 'simple'): void {
    const config = this.load();
    config.output = output;
    this.save(config);
  }

  /**
   * Get config file path
   */
  getConfigPath(): string {
    return this.configPath;
  }
}

export const configManager = new ConfigManager();
