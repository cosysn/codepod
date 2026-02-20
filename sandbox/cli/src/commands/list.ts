/**
 * List Sandboxes Command
 */

import { APIClient } from '../api';
import { configManager } from '../config';
import { Formatter } from '../formatter';

export async function listSandboxesCmd(): Promise<void> {
  const api = new APIClient();
  const formatter = new Formatter(configManager.load().output);

  try {
    const sandboxes = await api.listSandboxes();
    console.log(formatter.formatSandboxList(sandboxes));
  } catch (error) {
    const apiError = APIClient.handleError(error);
    console.error(`Error: ${apiError.message}`);
    process.exit(1);
  }
}
