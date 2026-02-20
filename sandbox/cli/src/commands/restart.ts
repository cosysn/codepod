/**
 * Restart Sandbox Command
 */

import inquirer from 'inquirer';
import { APIClient } from '../api';

export async function restartSandboxCmd(id?: string, force: boolean = false): Promise<void> {
  const api = new APIClient();

  if (!id) {
    const sandboxes = await api.listSandboxes();
    if (sandboxes.length === 0) {
      console.log('No sandboxes to restart.');
      return;
    }

    const answer = await inquirer.prompt<{ id: string }>([
      {
        type: 'list',
        name: 'id',
        message: 'Select sandbox to restart:',
        choices: sandboxes.map(s => ({
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
        message: `Are you sure you want to restart sandbox ${id.substring(0, 8)}?`,
        default: false,
      },
    ]);
    if (!answer.confirm) {
      console.log('Cancelled.');
      return;
    }
  }

  try {
    await api.restartSandbox(id);
    console.log('Sandbox restart initiated successfully.');
  } catch (error) {
    const apiError = APIClient.handleError(error);
    console.error(`Error: ${apiError.message}`);
    process.exit(1);
  }
}
