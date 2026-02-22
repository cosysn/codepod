/**
 * CodePod TypeScript SDK - Sandbox
 * Inspired by E2B SDK design
 */

import { ClientOptions, Sandbox as SandboxType, CreateSandboxRequest } from '../types';
import { CodePodClient } from '../client';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';

// Load the protobuf definition
const PROTO_PATH = path.join(__dirname, '../../proto/exec.proto');
let loadedProto: any = null;

function getProto() {
  if (!loadedProto) {
    const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
      keepCase: false,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    loadedProto = grpc.loadPackageDefinition(packageDefinition) as any;
  }
  return loadedProto;
}

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
 * Command execution options
 */
export interface CommandOptions {
  /** Callback for stdout data */
  onStdout?: (data: string) => void;
  /** Callback for stderr data */
  onStderr?: (data: string) => void;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Working directory */
  cwd?: string;
  /** Environment variables */
  env?: Record<string, string>;
}

// gRPC message types (generated from proto)
// These mirror the proto definitions

enum OutputChannel {
  STDOUT = 0,
  STDERR = 1,
}

interface CommandOutput {
  line?: string;
  channel?: OutputChannel;
  end?: boolean;
  exitCode?: number;
}

interface ExecuteRequest {
  command?: string;
  cwd?: string;
  env?: { [key: string]: string };
  timeout?: number;
}

/**
 * Options for Sandbox.create()
 */
export interface SandboxCreateOptions {
  /** Server base URL (default: http://localhost:8080) */
  baseURL?: string;
  /** API key for authentication */
  apiKey?: string;
  /** Timeout in milliseconds for sandbox creation and readiness (default: 120000ms) */
  timeout?: number;
  /** Sandbox image to use (default: codepod/default) */
  image?: string;
  /** Sandbox name */
  name?: string;
  /** CPU cores (default: 1) */
  cpu?: number;
  /** Memory allocation (default: '1Gi') */
  memory?: string;
  /** Environment variables */
  env?: Record<string, string>;
}

/**
 * Sandbox instance for a running sandbox
 */
export class Sandbox {
  private client: any;
  private sandbox: SandboxType;
  private grpcClient: grpc.Client | null = null;
  private grpcToken: string | null = null;

  /**
   * Create a new sandbox and wait for it to be ready
   * Similar to E2B's Sandbox.create() API
   * @param options Configuration options for sandbox creation
   * @returns Running Sandbox instance
   */
  static async create(options: SandboxCreateOptions): Promise<Sandbox> {
    const {
      baseURL = 'http://localhost:8080',
      apiKey,
      timeout = 120000,
      image = 'codepod/default',
      name,
      cpu,
      memory,
      env,
    } = options;

    // Create client
    const client = new CodePodClient({ baseURL, apiKey });

    // Build create request
    const request: CreateSandboxRequest = {
      image,
      name,
      cpu,
      memory,
      env,
    };

    // Create sandbox and wait for it to be running
    const sandbox = await client.createSandboxAndWait(request, timeout / 1000);

    return sandbox;
  }

  constructor(client: any, sandbox: SandboxType) {
    this.client = client;
    this.sandbox = sandbox;
  }

  /**
   * Get the commands interface for executing commands
   */
  get commands(): Commands {
    return new Commands(this.client, this);
  }

  /**
   * Close the gRPC connection
   */
  async close(): Promise<void> {
    if (this.grpcClient) {
      this.grpcClient.close();
      this.grpcClient = null;
    }
  }

  /**
   * Get or create gRPC client for the sandbox
   */
  private async getGrpcClient(): Promise<grpc.Client> {
    if (this.grpcClient) {
      return this.grpcClient;
    }

    // Get connection info from server
    const connectionInfo = await this.client.getConnectionInfo(this.sandbox.id);

    // Cache the token for reuse
    this.grpcToken = connectionInfo.token;

    // Create gRPC client with token in metadata
    const credentials = grpc.credentials.createInsecure();
    const metadata = new grpc.Metadata();
    metadata.add('token', connectionInfo.token);

    const client = new grpc.Client(
      `${connectionInfo.host}:${connectionInfo.port}`,
      credentials,
      {
        'grpc.keepalive_time_ms': 30000,
        'grpc.keepalive_timeout_ms': 10000,
        'grpc.enable_retries': 1,
      }
    );

    // Wait for the client to be ready
    await new Promise<void>((resolve, reject) => {
      client.waitForReady(Date.now() + 10000, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });

    this.grpcClient = client;
    return client;
  }

  /**
   * Get the cached gRPC token
   */
  private getGrpcToken(): string | null {
    return this.grpcToken;
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

/**
 * Commands provides command execution functionality via gRPC
 */
export class Commands {
  private client: any;
  private sandboxInstance: Sandbox;

  constructor(client: any, sandboxInstance: Sandbox) {
    this.client = client;
    this.sandboxInstance = sandboxInstance;
  }

  /**
   * Run a command in the sandbox
   * @param command The command to execute
   * @param options Execution options
   * @returns Command result with exit code, stdout, and stderr
   */
  async run(command: string, options?: CommandOptions): Promise<CommandResult> {
    const {
      onStdout,
      onStderr,
      timeout = 60000,
      cwd,
      env,
    } = options || {};

    // Collect stdout and stderr
    let stdout = '';
    let stderr = '';
    let exitCode = 0;
    let timedOut = false;
    let currentCall: grpc.ClientReadableStream<CommandOutput> | null = null;

    // Create timeout promise that can cancel the call
    const timeoutPromise = new Promise<CommandResult>((resolve, reject) => {
      setTimeout(() => {
        timedOut = true;
        // Cancel the gRPC call when timeout occurs
        if (currentCall) {
          currentCall.cancel();
        }
        reject(new Error(`Command timed out after ${timeout}ms`));
      }, timeout);
    });

    // Create execution promise
    const execPromise = (async () => {
      const grpcClient = await this.sandboxInstance['getGrpcClient']();

      // Get protobuf types
      const proto = getProto();

      // Prepare the request - use plain object that will be serialized by proto-loader
      const request = {
        command,
        cwd: cwd || '',
        env: env || {},
        timeout: timeout,
      };

      // Create metadata with token (reuse from getGrpcClient to avoid duplicate call)
      const metadata = new grpc.Metadata();
      metadata.add('token', this.sandboxInstance['getGrpcToken']() || '');

      // Use the proto's serialize method for message encoding
      const ExecuteRequest = proto.grpc.ExecuteRequest;
      const CommandOutput = proto.grpc.CommandOutput;

      // Make the gRPC call using makeServerStreamRequest with protobuf serialization
      const call = grpcClient.makeServerStreamRequest(
        '/grpc.ExecService/Execute',
        (value: any) => {
          // Use the serialize method from proto-loader - it returns a Buffer directly
          return ExecuteRequest.serialize(value);
        },
        (buffer: Buffer) => {
          try {
            // Use the deserialize method from proto-loader
            return CommandOutput.deserialize(buffer) as any;
          } catch (err) {
            // Fallback: try to parse as text if protobuf decoding fails
            console.error('Failed to decode protobuf:', err);
            return { line: buffer.toString(), channel: 0 };
          }
        },
        request,
        metadata
      );

      // Store the call reference for cancellation
      currentCall = call;

      // Helper to clean up event listeners
      const cleanupListeners = () => {
        call.removeAllListeners('data');
        call.removeAllListeners('end');
        call.removeAllListeners('error');
      };

      // Handle the stream
      try {
        await new Promise<void>((resolve, reject) => {
          call.on('data', (output: any) => {
            const line = output.line || '';
            const channel = output.channel; // This can be a string "STDOUT"/"STDERR" or number 0/1

            // Handle both string and numeric channel values
            const isStdout = channel === OutputChannel.STDOUT || channel === 'STDOUT' || channel === 0;
            const isStderr = channel === OutputChannel.STDERR || channel === 'STDERR' || channel === 1;

            if (isStdout) {
              stdout += line;
              if (onStdout) {
                onStdout(line);
              }
            } else if (isStderr) {
              stderr += line;
              if (onStderr) {
                onStderr(line);
              }
            }

            // Check for end of stream with exit code
            if (output.end === true && output.exitCode !== undefined) {
              exitCode = output.exitCode;
            }
          });

          call.on('end', () => {
            cleanupListeners();
            resolve();
          });

          call.on('error', (error: Error) => {
            cleanupListeners();
            reject(error);
          });
        });
      } catch (error) {
        cleanupListeners();
        throw error;
      }

      return {
        exitCode,
        stdout,
        stderr,
        timedOut: false,
      };
    })();

    // Race between execution and timeout
    try {
      return await Promise.race([execPromise, timeoutPromise]);
    } catch (error) {
      if (timedOut) {
        return {
          exitCode: -1,
          stdout,
          stderr,
          timedOut: true,
        };
      }
      throw error;
    }
  }
}

export default Sandbox;
