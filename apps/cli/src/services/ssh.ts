import { Client, ConnectConfig, ClientChannel } from 'ssh2';
import { EventEmitter } from 'events';

export interface SSHConfig {
  host: string;
  port: number;
  username: string;
  password: string;
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
   * Connect to SSH server
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.conn = new Client();

      this.conn.on('ready', () => {
        resolve();
      }).on('error', (err) => {
        reject(new Error(`SSH connection failed: ${err.message}`));
      }).connect(this.config as ConnectConfig);
    });
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
