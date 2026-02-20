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
    throw new Error('runCommand requires SSH connection. Use SandboxHandle for full implementation.');
  }

  /**
   * Upload a file to the sandbox
   */
  async uploadFile(path: string, content: Buffer | string): Promise<void> {
    // Placeholder for file upload
    throw new Error('uploadFile requires SSH connection. Use SandboxHandle for full implementation.');
  }

  /**
   * Download a file from the sandbox
   */
  async downloadFile(path: string): Promise<Buffer> {
    // Placeholder for file download
    throw new Error('downloadFile requires SSH connection. Use SandboxHandle for full implementation.');
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
