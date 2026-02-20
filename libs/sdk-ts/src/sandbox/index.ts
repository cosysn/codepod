/**
 * CodePod TypeScript SDK - Sandbox
 * Inspired by E2B SDK design
 */

import { ClientOptions, Sandbox as SandboxType } from '../types';

/**
 * Command execution result
 */
export interface CommandResult {
  /** Exit code of the command */
  exitCode: number;
  /** Standard output */
  stdout: string;
  /** Standard error */
  stderr: string;
  /** Whether the command timed out */
  timedOut?: boolean;
}

/**
 * Stream output from command execution
 */
export interface StreamOutput {
  /** Line content */
  line: string;
  /** Whether this is stdout or stderr */
  channel: 'stdout' | 'stderr';
}

/**
 * Sandbox instance for a running sandbox
 */
export class Sandbox {
  private client: any;
  private sandbox: SandboxType;

  constructor(client: any, sandbox: SandboxType) {
    this.client = client;
    this.sandbox = sandbox;
  }

  /**
   * Get the sandbox ID
   */
  get id(): string {
    return this.sandbox.id;
  }

  /**
   * Get the sandbox name
   */
  get name(): string {
    return this.sandbox.name;
  }

  /**
   * Get the sandbox status
   */
  get status(): string {
    return this.sandbox.status;
  }

  /**
   * Get the sandbox host
   */
  get host(): string {
    return this.sandbox.host;
  }

  /**
   * Get the sandbox port
   */
  get port(): number {
    return this.sandbox.port;
  }

  /**
   * Get the sandbox user
   */
  get user(): string {
    return this.sandbox.user;
  }

  /**
   * Get SSH connection info
   */
  get sshConfig() {
    return {
      host: this.sandbox.host,
      port: this.sandbox.port,
      user: this.sandbox.user,
      password: this.sandbox.token,
    };
  }

  /**
   * Check if sandbox is running
   */
  get isRunning(): boolean {
    return this.sandbox.status === 'running';
  }

  /**
   * Wait for sandbox to be running
   * @param timeout Maximum time to wait in seconds (default: 120)
   * @param interval Polling interval in milliseconds (default: 2000)
   * @throws Error if sandbox fails to start or timeout
   */
  async waitForRunning(timeout: number = 120, interval: number = 2000): Promise<void> {
    const startTime = Date.now();
    const maxTime = timeout * 1000;

    while (Date.now() - startTime < maxTime) {
      // Refresh sandbox status
      const updated = await this.client.getSandbox(this.sandbox.id);
      if (updated) {
        this.sandbox = updated;

        if (this.sandbox.status === 'running') {
          return; // Success!
        }

        if (this.sandbox.status === 'failed') {
          throw new Error(`Sandbox failed to start: ${this.sandbox.status}`);
        }

        if (this.sandbox.status === 'deleted') {
          throw new Error('Sandbox was deleted during creation');
        }
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, interval));
    }

    throw new Error(`Timeout waiting for sandbox to start (${timeout}s)`);
  }

  /**
   * Execute a command and wait for result
   */
  async runCommand(
    cmd: string,
    options?: {
      timeout?: number;
      env?: Record<string, string>;
      cwd?: string;
    }
  ): Promise<CommandResult> {
    // This would connect via SSH and execute
    // For now, return a placeholder
    throw new Error('runCommand requires SSH connection. Use SSHService for full implementation.');
  }

  /**
   * Upload a file to the sandbox
   */
  async uploadFile(path: string, content: Buffer | string): Promise<void> {
    // Placeholder for file upload
    throw new Error('uploadFile requires SSH connection. Use SSHService for full implementation.');
  }

  /**
   * Download a file from the sandbox
   */
  async downloadFile(path: string): Promise<Buffer> {
    // Placeholder for file download
    throw new Error('downloadFile requires SSH connection. Use SSHService for full implementation.');
  }

  /**
   * Get the sandbox token for SSH connection
   */
  async getToken(): Promise<string> {
    const response = await this.client.getSandboxToken(this.sandbox.id);
    return response.token;
  }

  /**
   * Stop the sandbox
   */
  async stop(): Promise<void> {
    await this.client.stopSandbox(this.sandbox.id);
  }

  /**
   * Start the sandbox
   */
  async start(): Promise<void> {
    await this.client.restartSandbox(this.sandbox.id);
    await this.waitForRunning();
  }

  /**
   * Delete the sandbox
   */
  async delete(): Promise<void> {
    await this.client.deleteSandbox(this.sandbox.id);
  }

  /**
   * Get raw sandbox data
   */
  getRawSandbox(): SandboxType {
    return this.sandbox;
  }
}

export default Sandbox;
