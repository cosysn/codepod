import { Command } from 'commander';
import { workspaceManager } from '../workspace/manager';

const stop = new Command('stop')
  .description('Stop a running workspace')
  .argument('<name>', 'Workspace name')
  .action(async (name) => {
    try {
      await workspaceManager.stop(name);
    } catch (error) {
      console.error('Failed to stop workspace:', error);
      process.exit(1);
    }
  });

export default stop;
