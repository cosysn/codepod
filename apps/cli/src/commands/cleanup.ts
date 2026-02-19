/**
 * Cleanup Command - Clean up orphaned/stuck sandboxes
 */

import { APIClient } from '../api';

export async function cleanupCmd(): Promise<void> {
  const api = new APIClient();

  try {
    const response = await api.request('/api/v1/cleanup', 'POST');
    console.log(`Cleanup completed. Removed ${response.cleaned} stuck sandbox(es).`);
  } catch (error) {
    console.error('Cleanup failed:', error);
    process.exit(1);
  }
}
