import { Command } from 'commander';

const deleteCmd = new Command('delete');
deleteCmd.description('Delete a development environment');
deleteCmd.action(() => {
  console.log('delete command - not yet implemented');
});

export default deleteCmd;
