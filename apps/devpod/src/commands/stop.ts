import { Command } from 'commander';

const stop = new Command('stop');
stop.description('Stop a running development environment');
stop.action(() => {
  console.log('stop command - not yet implemented');
});

export default stop;
