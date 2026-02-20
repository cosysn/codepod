import { Command } from 'commander';
import { getWorkspaceManager } from '../workspace/manager';

const start = new Command('start')
  .description('Start a stopped workspace')
  .argument('<name>', 'Workspace name')
  .action(async (name) => {
    try {
      await getWorkspaceManager().start(name);
    } catch (error) {
      console.error('Failed to start workspace:', error);
      process.exit(1);
    }
  });

export default start;
