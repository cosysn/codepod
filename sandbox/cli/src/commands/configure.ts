/**
 * Configure Command
 */

import inquirer from 'inquirer';
import { configManager } from '../config';

export async function configureCmd(): Promise<void> {
  const currentConfig = configManager.load();

  const answers = await inquirer.prompt<{ endpoint: string; apiKey: string; output: string }>([
    {
      type: 'input',
      name: 'endpoint',
      message: 'API endpoint:',
      default: currentConfig.endpoint,
    },
    {
      type: 'input',
      name: 'apiKey',
      message: 'API key (optional):',
      default: currentConfig.apiKey,
    },
    {
      type: 'list',
      name: 'output',
      message: 'Output format:',
      choices: ['table', 'json', 'simple'],
      default: currentConfig.output,
    },
  ]);

  configManager.setEndpoint(answers.endpoint);
  configManager.setAPIKey(answers.apiKey);
  configManager.setOutput(answers.output as 'json' | 'table' | 'simple');

  console.log('Configuration saved.');
  console.log(`Config file: ${configManager.getConfigPath()}`);
}
