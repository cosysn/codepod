/**
 * Create Sandbox Command
 */

import inquirer from 'inquirer';
import { APIClient } from '../api';
import { configManager } from '../config';
import { Formatter } from '../formatter';
import { CreateSandboxRequest } from '../types';

export async function createSandboxCmd(image?: string): Promise<void> {
  const api = new APIClient();
  const formatter = new Formatter(configManager.load().output);

  let request: CreateSandboxRequest;

  if (image) {
    request = { image };
  } else {
    const answers = await inquirer.prompt<{ image: string; name: string; cpu: number; memory: string }>([
      {
        type: 'input',
        name: 'image',
        message: 'Docker image:',
        validate: (input: string) => input.trim() !== '' || 'Image is required',
      },
      {
        type: 'input',
        name: 'name',
        message: 'Sandbox name (optional):',
        default: '',
      },
      {
        type: 'number',
        name: 'cpu',
        message: 'CPU cores (default 1):',
        default: 1,
      },
      {
        type: 'input',
        name: 'memory',
        message: 'Memory (default 512MB):',
        default: '512MB',
      },
    ]);

    request = {
      image: answers.image,
      name: answers.name || undefined,
      cpu: answers.cpu,
      memory: answers.memory,
    };
  }

  try {
    const response = await api.createSandbox(request);
    console.log('\nSandbox created successfully!');
    console.log(formatter.formatSandbox(response.sandbox));
    console.log(`\nSSH: ssh ${response.sandbox.user}@${response.sandbox.host} -p ${response.sandbox.sshPort}`);
    console.log(`Token: ${response.token}`);
  } catch (error) {
    const apiError = APIClient.handleError(error);
    console.error(`Error: ${apiError.message}`);
    process.exit(1);
  }
}
