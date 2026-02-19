#!/usr/bin/env node
/**
 * CodePod CLI
 */

import { Command } from 'commander';
import { VERSION } from './version';
import {
  createSandboxCmd,
  listSandboxesCmd,
  getSandboxCmd,
  deleteSandboxCmd,
  configureCmd,
  stopSandboxCmd,
  restartSandboxCmd,
  cleanupCmd,
} from './commands';
import { sshCommand } from './commands/ssh';

const program = new Command();

program
  .name('codepod')
  .description('CodePod - Sandbox management CLI')
  .version(VERSION);

program
  .command('create')
  .description('Create a new sandbox')
  .argument('[image]', 'Docker image')
  .action((image) => createSandboxCmd(image));

program
  .command('list')
  .alias('ls')
  .description('List all sandboxes')
  .action(() => listSandboxesCmd());

program
  .command('get')
  .alias('info')
  .description('Get sandbox details')
  .argument('[id]', 'Sandbox ID')
  .action((id) => getSandboxCmd(id));

program
  .command('delete')
  .alias('rm')
  .description('Delete a sandbox')
  .argument('[id]', 'Sandbox ID')
  .option('-f, --force', 'Skip confirmation')
  .action((id, options) => deleteSandboxCmd(id, options.force));

program
  .command('stop')
  .description('Stop a running sandbox')
  .argument('[id]', 'Sandbox ID')
  .action((id) => stopSandboxCmd(id));

program
  .command('restart')
  .description('Restart a sandbox')
  .argument('[id]', 'Sandbox ID')
  .action((id) => restartSandboxCmd(id));

program
  .command('configure')
  .alias('config')
  .description('Configure CLI settings')
  .action(() => configureCmd());

program
  .command('cleanup')
  .description('Clean up orphaned/stuck sandboxes')
  .action(() => cleanupCmd());

program.addCommand(sshCommand());

program.parse();
