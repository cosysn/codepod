/**
 * Delete Sandbox Command
 */

import inquirer from 'inquirer';
import { APIClient } from '../api';

export async function deleteSandboxCmd(id?: string, force: boolean = false): Promise<void> {
  const api = new APIClient();

  if (!id) {
    const sandboxes = await api.listSandboxes();
    if (sandboxes.length === 0) {
      console.log('No sandboxes to delete.');
      return;
    }

    const answer = await inquirer.prompt<{ id: string }>([
      {
        type: 'list',
        name: 'id',
        message: 'Select sandbox to delete:',
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
        message: `Are you sure you want to delete sandbox ${id.substring(0, 8)}?`,
        default: false,
      },
    ]);
    if (!answer.confirm) {
      console.log('Cancelled.');
      return;
    }
  }

  try {
    await api.deleteSandbox(id);
    console.log('Sandbox deleted successfully.');
  } catch (error) {
    const apiError = APIClient.handleError(error);
    console.error(`Error: ${apiError.message}`);
    process.exit(1);
  }
}
