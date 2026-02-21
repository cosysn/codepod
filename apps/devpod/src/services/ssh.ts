import { Client, ConnectConfig, ClientChannel } from 'ssh2';

export interface SSHConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  readyTimeout?: number;
  timeout?: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class SSHService {
  private conn: Client | null = null;
  private config: SSHConfig;

  constructor(config: SSHConfig) {
    this.config = {
      readyTimeout: 30000,
      timeout: 60000,
      ...config
    };
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.conn = new Client();

      const connectConfig: ConnectConfig = {
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        readyTimeout: this.config.readyTimeout,
        timeout: this.config.timeout,
      };

      if (this.config.password) {
        connectConfig.password = this.config.password;
      }

      if (this.config.privateKey) {
        connectConfig.privateKey = this.config.privateKey;
      }

      this.conn.on('ready', () => {
        resolve();
      }).on('error', (err) => {
        reject(new Error(`SSH connection failed: ${err.message}`));
      }).connect(connectConfig);
    });
  }

  async exec(command: string): Promise<ExecResult> {
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

        stream.on('close', (code: number) => {
          resolve({
            stdout,
            stderr,
            exitCode: code || 0
          });
        }).on('data', (data: Buffer) => {
          stdout += data.toString();
        }).stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });
      });
    });
  }

  async execStream(command: string, onData: (data: string) => void): Promise<number> {
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

        stream.on('close', (code: number) => {
          resolve(code || 0);
        }).on('data', (data: Buffer) => {
          onData(data.toString());
        }).stderr.on('data', (data: Buffer) => {
          onData(data.toString());
        });
      });
    });
  }

  async shell(): Promise<ClientChannel> {
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

  disconnect(): void {
    if (this.conn) {
      this.conn.end();
      this.conn = null;
    }
  }

  static async connectWithPassword(
    host: string,
    port: number,
    username: string,
    password: string,
    retries: number = 5,
    delayMs: number = 3000
  ): Promise<SSHService> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const ssh = new SSHService({ host, port, username, password });
        await ssh.connect();
        return ssh;
      } catch (error) {
        lastError = error as Error;
        console.log(`SSH connection attempt ${attempt}/${retries} failed: ${lastError.message}`);
        if (attempt < retries) {
          console.log(`Retrying in ${delayMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }

    throw new Error(`SSH connection failed after ${retries} attempts: ${lastError?.message}`);
  }
}
