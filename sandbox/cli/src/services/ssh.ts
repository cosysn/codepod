import * as fs from 'fs';
import * as path from 'path';
import { Client, ConnectConfig, ClientChannel, OpenSSHAgent } from 'ssh2';
import { EventEmitter } from 'events';
import { sshCertService } from './ssh-ca';

export interface SSHConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  privateKeyPath?: string;
  certificate?: string;
  certificatePath?: string;
  readyTimeout?: number;
  timeout?: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class SSHService extends EventEmitter {
  private config: SSHConfig;
  private conn: Client | null = null;

  constructor(config: SSHConfig) {
    super();
    this.config = {
      readyTimeout: 10000,
      timeout: 30000,
      ...config,
    };
  }

  /**
   * Build ssh2 ConnectConfig from SSHConfig
   */
  private buildConnectConfig(): ConnectConfig {
    const cfg: ConnectConfig = {
      host: this.config.host,
      port: this.config.port,
      username: this.config.username,
      readyTimeout: this.config.readyTimeout,
      timeout: this.config.timeout,
    };

    // Use file paths if available, otherwise use inline content
    if (this.config.certificatePath && this.config.privateKeyPath) {
      // Use file paths for certificate-based auth
      // Note: ssh2 types don't include these, but the library supports them
      (cfg as any).privateKeyPath = this.config.privateKeyPath;
      (cfg as any).cert = this.config.certificatePath;
    } else if (this.config.certificate && this.config.privateKey) {
      // Load from inline content - combine cert after private key
      // ssh2 expects: private key followed by certificate on new lines
      cfg.privateKey = `${this.config.privateKey}\n${this.config.certificate}`;
    } else if (this.config.password) {
      cfg.password = this.config.password;
    }

    return cfg;
  }

  /**
   * Connect to SSH server
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.conn = new Client();

      const connectCfg = this.buildConnectConfig();

      this.conn.on('ready', () => {
        console.log('SSH connection ready');
        resolve();
      }).on('error', (err: Error) => {
        console.error(`SSH connection error: ${err.message}`);
        reject(new Error(`SSH connection failed: ${err.message}`));
      }).connect(connectCfg);
    });
  }

  /**
   * Build SSH config based on authentication method
   */
  static buildConfig(
    host: string,
    port: number,
    username: string,
    options: { password?: string; privateKey?: string; privateKeyPath?: string; certificate?: string; certificatePath?: string }
  ): SSHConfig {
    const config: SSHConfig = {
      host,
      port,
      username,
    };

    if (options.certificate && (options.privateKey || options.privateKeyPath)) {
      // Use certificate authentication - prefer file paths for ssh2 library
      if (options.privateKeyPath) {
        config.privateKeyPath = options.privateKeyPath;
      }
      if (options.certificate) {
        config.certificate = options.certificate;
      }
      if (options.privateKey) {
        config.privateKey = options.privateKey;
      }
      if (options.certificate) {
        config.certificate = options.certificate;
      }
    } else if (options.password) {
      // Use password authentication
      config.password = options.password;
    }

    return config;
  }

  /**
   * Create SSH service with certificate authentication
   */
  static async createWithCertificate(
    host: string,
    port: number,
    sandboxId: string,
    serverUrl: string,
    apiKey?: string
  ): Promise<SSHService> {
    // Check if we have existing certificate
    if (!sshCertService.hasCertificate(sandboxId)) {
      // Generate new key pair
      sshCertService.generateKeyPair(sandboxId);
      // Request certificate from server
      await sshCertService.requestCertificate(sandboxId, serverUrl, apiKey);
    }

    const privateKeyPath = sshCertService.getPrivateKeyPath(sandboxId)!;
    const certPath = sshCertService.getCertificatePath(sandboxId)!;

    const privateKey = fs.readFileSync(privateKeyPath, 'utf-8');
    const certificate = fs.readFileSync(certPath, 'utf-8');

    const config = SSHService.buildConfig(host, port, 'root', {
      privateKey,
      certificate,
    });

    return new SSHService(config);
  }

  /**
   * Execute a single command
   */
  exec(command: string): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      if (!this.conn) {
        reject(new Error('Not connected'));
        return;
      }

      this.conn.exec(command, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        let stdout = '';
        let stderr = '';

        stream.on('close', (code: number, signal: string | null) => {
          resolve({
            stdout,
            stderr,
            exitCode: code || 0,
          });
        }).on('data', (data: Buffer) => {
          stdout += data.toString();
        }).stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });
      });
    });
  }

  /**
   * Start an interactive shell session
   */
  shell(): Promise<ClientChannel> {
    return new Promise((resolve, reject) => {
      if (!this.conn) {
        reject(new Error('Not connected'));
        return;
      }

      this.conn.shell((err, stream) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(stream);
      });
    });
  }

  /**
   * Close connection
   */
  disconnect(): void {
    if (this.conn) {
      this.conn.end();
      this.conn = null;
    }
  }
}
