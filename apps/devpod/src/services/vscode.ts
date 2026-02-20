import * as fs from 'fs';
import * as childProcess from 'child_process';
import { getSandbox, getSandboxToken } from '../api/client';
import { Sandbox } from '@codepod/sdk-ts';

export interface VSCodeConnectOptions {
  sandboxId: string;
  workspacePath?: string;
}

export class VSCodeConnector {
  async connect(options: VSCodeConnectOptions): Promise<void> {
    const sandbox = await getSandbox(options.sandboxId);
    if (!sandbox) {
      throw new Error(`Sandbox ${options.sandboxId} not found`);
    }

    if (sandbox.status !== 'running') {
      throw new Error(`Sandbox ${options.sandboxId} is not running`);
    }

    const token = await getSandboxToken(sandbox.id);

    // Get or generate SSH key for VS Code
    let privateKey = process.env.SSH_KEY;
    let publicKey = process.env.SSH_KEY_PUB;

    if (!privateKey) {
      // Generate key pair if not exists
      try {
        childProcess.execSync('ssh-keygen -t ed25519 -f ~/.ssh/devpod -N ""', { stdio: 'ignore' });
        privateKey = childProcess.execSync('cat ~/.ssh/devpod', { encoding: 'utf-8' }).trim();
        publicKey = childProcess.execSync('cat ~/.ssh/devpod.pub', { encoding: 'utf-8' }).trim();
      } catch {
        throw new Error('Failed to generate SSH key. Please set SSH_KEY and SSH_KEY_PUB environment variables.');
      }
    }

    // Build VS Code remote command
    const workspaceArg = options.workspacePath || '/workspace';
    const remoteArg = `ssh-remote+${sandbox.user}@${sandbox.host}:${sandbox.port}`;

    console.log('Opening VS Code...');
    console.log(`Workspace: ${workspaceArg}`);
    console.log(`Connecting to: ${sandbox.user}@${sandbox.host}:${sandbox.port}`);

    // Generate temporary SSH config
    const sshConfig = `
Host devpod-${sandbox.id}
  HostName ${sandbox.host}
  Port ${sandbox.port}
  User ${sandbox.user}
  PasswordAuthentication yes
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
`;

    // Write temp config and launch VS Code
    const tempConfig = '/tmp/devpod-ssh-config';
    fs.writeFileSync(tempConfig, sshConfig);

    try {
      childProcess.spawnSync('code', [
        '--remote',
        `ssh-remote+${sandbox.user}@${sandbox.host}:${sandbox.port}`,
        workspaceArg,
        '--folder-uri',
        `vscode-remote://${sandbox.host}:${sandbox.port}${workspaceArg}`
      ], {
        stdio: 'inherit'
      });
    } catch (error) {
      console.log('VS Code not found or failed to launch.');
      console.log('Manual connection:');
      console.log(`  Host: ${sandbox.host}`);
      console.log(`  Port: ${sandbox.port}`);
      console.log(`  User: ${sandbox.user}`);
      console.log(`  Password: ${token}`);
    }
  }
}

// Singleton instance - lazily created
let vscodeConnectorInstance: VSCodeConnector | null = null;

export function getVSCodeConnector(): VSCodeConnector {
  if (!vscodeConnectorInstance) {
    vscodeConnectorInstance = new VSCodeConnector();
  }
  return vscodeConnectorInstance;
}
