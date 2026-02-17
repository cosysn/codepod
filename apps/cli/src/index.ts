#!/usr/bin/env node
/**
 * CodePod CLI
 */

import { Command } from 'commander';
import { VERSION } from './version';
import {
  createSandboxCmd,
  listSandboxesCmd,
  deleteSandboxCmd,
  sshCmd,
  configureCmd,
} from './commands';

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
  .command('delete')
  .alias('rm')
  .description('Delete a sandbox')
  .argument('[id]', 'Sandbox ID')
  .option('-f, --force', 'Skip confirmation')
  .action((id, options) => deleteSandboxCmd(id, options.force));

program
  .command('ssh')
  .description('Get SSH connection info for a sandbox')
  .argument('<id>', 'Sandbox ID')
  .action((id) => sshCmd(id));

program
  .command('configure')
  .alias('config')
  .description('Configure CLI settings')
  .action(() => configureCmd());

program.parse();
