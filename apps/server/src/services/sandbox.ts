/**
 * Sandbox service
 */

import { store } from '../db/store';
import { Sandbox, SandboxStatus, CreateSandboxRequest, SandboxResponse } from '../types';
import { createJob } from './job';

// Simple UUID generator
function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export class SandboxService {
  /**
   * Create a new sandbox
   */
  create(req: CreateSandboxRequest): SandboxResponse {
    // Validate request
    if (!req.image) {
      throw new Error('Image is required');
    }

    // Create sandbox
    const sandbox = store.createSandbox(req);

    // Create job for runner
    createJob({
      type: 'create',
      sandboxId: sandbox.id,
      image: req.image || sandbox.image,
    });

    // Generate connection info
    const token = this.generateToken();

    return {
      sandbox: {
        ...sandbox,
        token,
      },
      sshHost: 'localhost',
      sshPort: 2222,
      sshUser: 'root',
      token,
    };
  }

  /**
   * Get sandbox by ID
   */
  get(id: string): Sandbox | undefined {
    return store.getSandbox(id);
  }

  /**
   * List all sandboxes
   */
  list(): { sandboxes: Sandbox[]; total: number } {
    const sandboxes = store.listSandboxes();
    return {
      sandboxes,
      total: sandboxes.length,
    };
  }

  /**
   * Delete sandbox
   */
  delete(id: string): boolean {
    return store.deleteSandbox(id);
  }

  /**
   * Update sandbox status
   */
  updateStatus(id: string, status: SandboxStatus): Sandbox | undefined {
    return store.updateSandbox(id, { status });
  }

  /**
   * Get sandbox connection token
   */
  getConnectionToken(id: string): string | undefined {
    const sandbox = store.getSandbox(id);
    if (!sandbox) return undefined;

    return sandbox.token;
  }

  /**
   * Generate a secure connection token
   */
  private generateToken(): string {
    return `cp_${generateId().replace(/-/g, '').slice(0, 32)}`;
  }

  /**
   * Get sandbox statistics
   */
  getStats(): {
    total: number;
    running: number;
    pending: number;
    stopped: number;
  } {
    const sandboxes = store.listSandboxes();

    return {
      total: sandboxes.length,
      running: sandboxes.filter((s) => s.status === 'running').length,
      pending: sandboxes.filter((s) => s.status === 'pending').length,
      stopped: sandboxes.filter((s) => s.status === 'stopped').length,
    };
  }
}

export const sandboxService = new SandboxService();
