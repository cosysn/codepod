import { Command } from 'commander';
import { workspaceManager } from '../workspace/manager';

const list = new Command('list')
  .description('List all workspaces')
  .action(async () => {
    await workspaceManager.list();
  });

export default list;
