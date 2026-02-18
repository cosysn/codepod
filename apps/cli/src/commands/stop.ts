/**
 * Stop Sandbox Command
 */

import inquirer from 'inquirer';
import { APIClient } from '../api';

export async function stopSandboxCmd(id?: string, force: boolean = false): Promise<void> {
  const api = new APIClient();

  if (!id) {
    const sandboxes = await api.listSandboxes();
    if (sandboxes.length === 0) {
      console.log('No sandboxes to stop.');
      return;
    }

    const runningSandboxes = sandboxes.filter(s => s.status === 'running');
    if (runningSandboxes.length === 0) {
      console.log('No running sandboxes to stop.');
      return;
    }

    const answer = await inquirer.prompt<{ id: string }>([
      {
        type: 'list',
        name: 'id',
        message: 'Select sandbox to stop:',
        choices: runningSandboxes.map(s => ({
          name: `${s.name} (${s.status}) - ${s.id.substring(0, 8)}`,
          value: s.id,
        })),
      },
    ]);
    id = answer.id;
  }

  if (!force) {
    const answer = await inquirer.prompt<{ confirm: boolean }>([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Are you sure you want to stop sandbox ${id.substring(0, 8)}?`,
        default: false,
      },
    ]);
    if (!answer.confirm) {
      console.log('Cancelled.');
      return;
    }
  }

  try {
    await api.stopSandbox(id);
    console.log('Sandbox stopped successfully.');
  } catch (error) {
    const apiError = APIClient.handleError(error);
    console.error(`Error: ${apiError.message}`);
    process.exit(1);
  }
}
