import { Command } from 'commander';

const up = new Command('up');
up.description('Create and start a new development environment');
up.action(() => {
  console.log('up command - not yet implemented');
});

export default up;
