import { Command } from 'commander';

const list = new Command('list');
list.description('List all development environments');
list.action(() => {
  console.log('list command - not yet implemented');
});

export default list;
