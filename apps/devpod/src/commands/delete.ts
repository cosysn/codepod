import { Command } from 'commander';
import { getWorkspaceManager } from '../workspace/manager';

const deleteCmd = new Command('delete')
  .alias('rm')
  .description('Delete a workspace')
  .argument('<name>', 'Workspace name')
  .action(async (name) => {
    try {
      await getWorkspaceManager().delete(name);
    } catch (error) {
      console.error('Failed to delete workspace:', error);
      process.exit(1);
    }
  });

export default deleteCmd;
