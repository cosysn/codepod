/**
 * CodePod SDK Example: Run Command
 *
 * This example demonstrates how to create a sandbox and run commands in it.
 * Inspired by E2B SDK design.
 *
 * Usage:
 *   npx ts-node examples/run-command.ts
 *
 * Or compile and run:
 *   npx tsc -p examples/tsconfig.json
 *   node examples/dist/run-command.js
 */

import { Sandbox, SandboxCreateOptions } from '../dist';

// Configuration
const config: SandboxCreateOptions = {
  // Server configuration
  baseURL: process.env.CODEPOD_URL || 'http://localhost:8080',
  apiKey: process.env.CODEPOD_API_KEY || 'cp_2a03c9f03fd94bd8906c3aa9fdfc153d',

  // Sandbox configuration
  timeout: 60_000, // 60 seconds
  image: 'codepod/builder',
  name: 'example-sandbox',
  cpu: 1,
  memory: '1Gi',
};

async function main() {
  let sandbox: Sandbox | null = null;

  try {
    console.log('Creating sandbox...');
    console.log(`  Server: ${config.baseURL}`);
    console.log(`  Image: ${config.image}`);
    console.log(`  Timeout: ${config.timeout}ms`);
    console.log('');

    // Create sandbox (similar to E2B's Sandbox.create())
    sandbox = await Sandbox.create({
      baseURL: config.baseURL,
      apiKey: config.apiKey,
      timeout: config.timeout,
      image: config.image,
      name: config.name,
      cpu: config.cpu,
      memory: config.memory,
    });

    console.log(`Sandbox created successfully!`);
    console.log(`  ID: ${sandbox.id}`);
    console.log(`  Name: ${sandbox.name}`);
    console.log(`  Status: ${sandbox.status}`);
    console.log(`  Host: ${sandbox.host}:${sandbox.port}`);
    console.log('');

    // Run a command with stdout/stderr callbacks (E2B style)
    console.log('Running command: echo "Hello from CodePod!"');
    console.log('---');

    const result = await sandbox.commands.run('echo "Hello from CodePod!"', {
      onStdout: (data) => process.stdout.write(data),
      onStderr: (data) => process.stderr.write(data),
      timeout: 30_000,
    });

    console.log('---');
    console.log(`Command finished with exit code: ${result.exitCode}`);
    console.log('');

    // Run another command and capture output
    console.log('Running command: uname -a');
    const result2 = await sandbox.commands.run('uname -a', {
      timeout: 30_000,
    });

    console.log('---');
    console.log('Output:');
    console.log(result2.stdout);
    console.log(`Exit code: ${result2.exitCode}`);
    console.log('');

    // Run a command that produces stderr
    console.log('Running command: ls /nonexistent 2>&1');
    const result3 = await sandbox.commands.run('ls /nonexistent 2>&1', {
      timeout: 30_000,
    });

    console.log('---');
    console.log('stdout:', result3.stdout || '(empty)');
    console.log('stderr:', result3.stderr || '(empty)');
    console.log(`Exit code: ${result3.exitCode}`);
    console.log('');

    console.log('Example completed successfully!');
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    // Clean up: stop and delete the sandbox
    if (sandbox) {
      console.log('');
      console.log('Cleaning up sandbox...');
      try {
        await sandbox.stop();
        console.log('Sandbox stopped.');
        await sandbox.delete();
        console.log('Sandbox deleted.');
      } catch (cleanupError) {
        console.error('Cleanup error:', cleanupError instanceof Error ? cleanupError.message : cleanupError);
      }
    }
  }
}

main();
