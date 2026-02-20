import * as pty from 'node-pty';
import { EventEmitter } from 'events';

export class PTYService extends EventEmitter {
  private ptyProcess: pty.IPty | null = null;
  private dataDisposable?: pty.IDisposable;
  private exitDisposable?: pty.IDisposable;

  /**
   * Start a PTY process
   */
  start(config: { command?: string; args?: string[]; env?: Record<string, string>; cols?: number; rows?: number } = {}): void {
    const { command = '/bin/sh', args = [], env = {}, cols = 80, rows = 24 } = config;

    this.ptyProcess = pty.spawn(command, args, {
      env: { ...process.env, ...env },
      cols,
      rows,
      name: 'xterm-color',
    });

    // node-pty uses IEvent interface - call it as a function
    this.dataDisposable = this.ptyProcess.onData((data: string) => {
      this.emit('data', data);
    });

    this.exitDisposable = this.ptyProcess.onExit((exitInfo: { exitCode: number; signal?: number }) => {
      this.emit('exit', exitInfo.exitCode, exitInfo.signal);
    });
  }

  /**
   * Write data to PTY
   */
  write(data: string): void {
    if (this.ptyProcess) {
      this.ptyProcess.write(data);
    }
  }

  /**
   * Resize PTY
   */
  resize(cols: number, rows: number): void {
    if (this.ptyProcess) {
      this.ptyProcess.resize(cols, rows);
    }
  }

  /**
   * Get the PTY process instance
   */
  getPty(): pty.IPty | null {
    return this.ptyProcess;
  }

  /**
   * Kill PTY process
   */
  kill(signal?: string): void {
    if (this.ptyProcess) {
      this.ptyProcess.kill(signal || 'SIGTERM');
      this.ptyProcess = null;
    }
  }

  /**
   * Check if PTY is running
   */
  isRunning(): boolean {
    return this.ptyProcess !== null;
  }
}
