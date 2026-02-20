import { Command } from 'commander';
import { configManager } from '../config';

function splitKeyValue(input: string): [string, string] {
  const parts = input.split(' ');
  if (parts.length !== 2) {
    throw new Error('Invalid format. Use: key value');
  }
  return [parts[0], parts[1]];
}

const configCmd = new Command('config')
  .description('Manage DevPod configuration')
  .alias('cfg');

configCmd
  .command('get <key>')
  .description('Get a configuration value')
  .action((key) => {
    const config = configManager.load();
    const value = (config as unknown as Record<string, string>)[key];
    if (value === undefined) {
      console.error(`Unknown config key: ${key}`);
      console.error(`Available keys: endpoint, registry`);
      process.exit(1);
    }
    console.log(value);
  });

configCmd
  .command('set <key> <value>')
  .description('Set a configuration value')
  .action((key, value) => {
    const config = configManager.load();

    if (!(key in config)) {
      console.error(`Unknown config key: ${key}`);
      console.error(`Available keys: endpoint, registry`);
      process.exit(1);
    }

    (config as unknown as Record<string, string>)[key] = value;
    configManager.save(config);
    console.log(`Set ${key} = ${value}`);
  });

configCmd
  .command('list')
  .description('List all configuration values')
  .action(() => {
    const config = configManager.load();
    console.log(JSON.stringify(config, null, 2));
  });

export default configCmd;
