import { Command } from 'commander';
import { workspaceManager } from '../workspace/manager';

const up = new Command('up')
  .description('Create workspace and open VS Code')
  .argument('<repo-url>', 'Git repository URL')
  .option('--name <name>', 'Workspace name (derived from repo if not specified)')
  .option('--cpu <cpu>', 'Builder CPU cores', '2')
  .option('--memory <memory>', 'Builder memory', '4Gi')
  .option('--dev-cpu <cpu>', 'Dev sandbox CPU cores', '2')
  .option('--dev-memory <memory>', 'Dev sandbox memory', '4Gi')
  .option('--dockerfile <path>', 'Path to Dockerfile', '.devcontainer/Dockerfile')
  .action(async (repoUrl, options) => {
    const name = options.name || extractNameFromRepo(repoUrl);

    try {
      await workspaceManager.create({
        repoUrl,
        name,
        builderCpu: parseInt(options.cpu),
        builderMemory: options.memory,
        devCpu: parseInt(options.devCpu),
        devMemory: options.devMemory,
        dockerfilePath: options.dockerfile
      });

      console.log('');
      console.log('Workspace created successfully!');
      console.log(`Run: devpod connect ${name}`);

    } catch (error) {
      console.error('Failed to create workspace:', error);
      process.exit(1);
    }
  });

function extractNameFromRepo(url: string): string {
  const match = url.match(/\/([^/]+)\/?$/);
  return match ? match[1].replace('.git', '') : 'workspace';
}

export default up;
