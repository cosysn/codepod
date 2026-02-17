/**
 * SSH Command - Get connection info
 */

import { APIClient } from '../api';

export async function sshCmd(id: string): Promise<void> {
  const api = new APIClient();

  try {
    const sandbox = await api.getSandbox(id);
    const token = await api.getToken(id);

    console.log(`\nSandbox: ${sandbox.name}`);
    console.log(`SSH: ssh ${sandbox.user}@${sandbox.host} -p ${sandbox.port}`);
    console.log(`Token: ${token}`);
  } catch (error) {
    const apiError = APIClient.handleError(error);
    console.error(`Error: ${apiError.message}`);
    process.exit(1);
  }
}
