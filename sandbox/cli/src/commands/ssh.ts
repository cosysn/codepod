import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { APIClient } from '../api';
import { SSHService, SSHConfig } from '../services/ssh';
import { sshCertService } from '../services/ssh-ca';
import { configManager } from '../config';
import ora from 'ora';

interface SSHOptions {
  command?: string;
  interactive?: boolean;
}

export function sshCommand(): Command {
  const command = new Command('ssh')
    .description('Connect to sandbox via SSH')
    .argument('<id>', 'Sandbox ID')
    .option('--command <cmd>', 'Execute command and exit')
    .option('--interactive', 'Force interactive mode', true)
    .action(async (id, options: SSHOptions) => {
      const spinner = ora('Connecting to sandbox...').start();

      try {
        // Get sandbox info
        const api = new APIClient();
        const sandbox = await api.getSandbox(id);

        if (!sandbox) {
          spinner.fail(`Sandbox not found: ${id}`);
          process.exit(1);
        }

        if (sandbox.status !== 'running') {
          spinner.fail(`Sandbox is not running (status: ${sandbox.status})`);
          process.exit(1);
        }

        // Get server URL
        const serverUrl = configManager.getEndpoint();
        const apiKey = configManager.getAPIKey();

        // Get sandbox connection info
        const host = sandbox.host || 'localhost';
        const port = sandbox.port || 22;
        const user = sandbox.user || 'root';

        // Use password authentication with the sandbox token
        const token = sandbox.token || '';

        spinner.text = 'Connecting with token authentication...';
        const sshConfig = SSHService.buildConfig(
          host,
          port,
          user,
          {
            password: token,
          }
        );

        spinner.succeed('Connected');

        // Connect via SSH
        await connectViaSSH(sshConfig, options);
      } catch (error: any) {
        spinner.fail(`Connection failed: ${error.message}`);
        process.exit(1);
      }
    });

  return command;
}

async function connectViaSSH(
  config: SSHConfig,
  options: SSHOptions
): Promise<void> {
  const ssh = new SSHService(config);

  await ssh.connect();

  if (options.command) {
    // Execute single command
    const result = await ssh.exec(options.command);
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    ssh.disconnect();
    process.exit(result.exitCode);
  } else {
    // Interactive shell
    console.log(`Connected to sandbox. Type 'exit' to disconnect.\n`);

    const stream = await ssh.shell();

    // Handle terminal
    process.stdin.setRawMode(true);
    stream.pipe(process.stdout);

    // Handle input
    process.stdin.pipe(stream);

    stream.on('close', () => {
      process.stdin.setRawMode(false);
      ssh.disconnect();
      process.exit(0);
    });
  }
}
