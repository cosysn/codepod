import * as grpc from '@grpc/grpc-js';

export interface RunnerInfo {
  id: string;
  address: string;
  capacity: number;
  status: 'available' | 'busy';
}

export class GrpcServer {
  private server: grpc.Server;
  private port: string;
  private runners: Map<string, RunnerInfo>;

  constructor(port: number = 50051) {
    this.server = new grpc.Server();
    this.port = `0.0.0.0:${port}`;
    this.runners = new Map();
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.bindAsync(
        this.port,
        grpc.ServerCredentials.createInsecure(),
        (err, port) => {
          if (err) {
            reject(err);
            return;
          }
          console.log(`gRPC Server listening on ${port}`);
          resolve();
        }
      );
    });
  }

  stop(): void {
    this.server.forceShutdown();
  }

  registerRunner(info: RunnerInfo): void {
    this.runners.set(info.id, info);
  }

  getRunner(id: string): RunnerInfo | undefined {
    return this.runners.get(id);
  }

  listRunners(): RunnerInfo[] {
    return Array.from(this.runners.values());
  }
}
