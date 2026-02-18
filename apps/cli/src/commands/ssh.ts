import { Command } from 'commander';
import { APIClient } from '../api';
import { SSHService } from '../services/ssh';
import ora from 'ora';

interface SSHOptions {
  command?: string;
  interactive?: boolean;
}

export function sshCommand(): Command {
  const command = new Command('ssh <id>')
    .description('Connect to sandbox via SSH')
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

        spinner.succeed('Connected');

        // Get connection token
        const token = await api.getToken(id);

        // Connect via SSH
        await connectViaSSH(
          {
            host: sandbox.host,
            port: sandbox.port || 22,
            username: sandbox.user,
          },
          token,
          options
        );
      } catch (error: any) {
        spinner.fail(`Connection failed: ${error.message}`);
        process.exit(1);
      }
    });

  return command;
}

async function connectViaSSH(
  config: { host: string; port: number; username: string },
  token: string,
  options: SSHOptions
): Promise<void> {
  const ssh = new SSHService({
    host: config.host,
    port: config.port,
    username: config.username,
    password: token,
  });

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
