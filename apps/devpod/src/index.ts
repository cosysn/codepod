#!/usr/bin/env node
import { Command } from 'commander';
import { configManager } from './config';
import up from './commands/up';
import list from './commands/list';
import deleteCmd from './commands/delete';
import stop from './commands/stop';
import start from './commands/start';

const program = new Command();

program
  .name('devpod')
  .description('Development environment manager using CodePod Sandbox')
  .version('0.1.0');

program.addCommand(up);
program.addCommand(list);
program.addCommand(deleteCmd);
program.addCommand(stop);
program.addCommand(start);

program.parse();
