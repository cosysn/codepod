import { Command } from 'commander';
import { getWorkspaceManager } from '../workspace/manager';

const list = new Command('list')
  .description('List all workspaces')
  .action(async () => {
    await getWorkspaceManager().list();
  });

export default list;
