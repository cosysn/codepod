/**
 * Get Sandbox Command
 */

import { APIClient } from '../api';
import { Formatter } from '../formatter';

export async function getSandboxCmd(id?: string): Promise<void> {
  const api = new APIClient();

  if (!id) {
    const sandboxes = await api.listSandboxes();
    if (sandboxes.length === 0) {
      console.log('No sandboxes found.');
      return;
    }
    // Default to first sandbox
    id = sandboxes[0].id;
  }

  try {
    const sandbox = await api.getSandbox(id);
    const formatter = new Formatter();
    console.log(formatter.formatSandbox(sandbox));
  } catch (error) {
    const apiError = APIClient.handleError(error);
    console.error(`Error: ${apiError.message}`);
    process.exit(1);
  }
}
