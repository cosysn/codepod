/**
 * Volume service
 */

import { store } from '../db/store';
import { CreateVolumeRequest, CreateVolumeResponse } from '../types';

// Simple UUID generator
function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export class VolumeService {
  /**
   * Create a new volume
   * Note: For local storage, we just create the record.
   * For distributed storage, this would dispatch to a runner.
   */
  create(req: CreateVolumeRequest): CreateVolumeResponse {
    // Validate request
    if (!req.name) {
      throw new Error('Volume name is required');
    }

    // Create volume record
    const volume = store.createVolume(req);

    // For local storage, generate a host path
    // In production, this would be provided by the runner
    const hostPath = `/var/lib/docker/volumes/${volume.id}/_data`;

    // Update volume with host path
    store.updateVolumeHostPath(volume.id, hostPath);

    return {
      volumeId: volume.id,
      hostPath,
    };
  }

  /**
   * Get volume by ID
   */
  get(id: string) {
    return store.getVolume(id);
  }

  /**
   * List all volumes
   */
  list(): { volumes: ReturnType<typeof store.listVolumes> } {
    return {
      volumes: store.listVolumes(),
    };
  }

  /**
   * Delete volume
   */
  delete(id: string): boolean {
    return store.deleteVolume(id);
  }
}

export const volumeService = new VolumeService();
