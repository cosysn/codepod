import { Command } from 'commander';

const start = new Command('start');
start.description('Start an existing development environment');
start.action(() => {
  console.log('start command - not yet implemented');
});

export default start;
