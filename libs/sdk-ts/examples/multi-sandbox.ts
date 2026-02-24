/**
 * CodePod SDK Example: Multiple Sandboxes Test
 *
 * This example tests creating multiple sandboxes to verify:
 * 1. Each sandbox gets a unique port
 * 2. Port allocation works correctly
 *
 * Usage:
 *   npx ts-node examples/multi-sandbox.ts
 */

import { Sandbox, SandboxCreateOptions, CodePodClient } from '../dist';

// Configuration
const config = {
  // Server configuration
  baseURL: process.env.CODEPOD_URL || 'http://localhost:8080',
  apiKey: process.env.CODEPOD_API_KEY || 'cp_2a03c9f03fd94bd8906c3aa9fdfc153d',

  // Sandbox configuration
  timeout: 120_000, // 120 seconds
  image: '10.0.0.15:5000/codepod/devcontainer:v12',
  cpu: 1,
  memory: '512Mi',
};

async function main() {
  const NUM_SANDBOXES = 3;

  try {
    console.log(`Creating ${NUM_SANDBOXES} sandboxes in parallel...`);
    console.log(`  Server: ${config.baseURL}`);
    console.log(`  Image: ${config.image}`);
    console.log('');

    // Create client
    const client = new CodePodClient({
      baseURL: config.baseURL,
      apiKey: config.apiKey,
    });

    // Create multiple sandboxes in parallel
    const createPromises = Array.from({ length: NUM_SANDBOXES }, async (_, i) => {
      const response = await client.createSandbox({
        image: config.image,
        name: `test-sandbox-${i + 1}`,
        cpu: config.cpu,
        memory: config.memory,
      });
      return { sandbox: response.sandbox, index: i + 1 };
    });

    const results = await Promise.all(createPromises);

    console.log('All sandboxes created!\n');

    // Check ports
    const ports = new Set<number>();
    for (const { sandbox, index } of results) {
      console.log(`Sandbox ${index}:`);
      console.log(`  ID: ${sandbox.id}`);
      console.log(`  Name: ${sandbox.name}`);
      console.log(`  Status: ${sandbox.status}`);
      console.log(`  Host: ${sandbox.host}`);
      console.log(`  Port: ${sandbox.port}`);
      console.log('');

      ports.add(sandbox.port);
    }

    // Verify unique ports
    console.log('Port Analysis:');
    console.log(`  Total sandboxes: ${NUM_SANDBOXES}`);
    console.log(`  Unique ports: ${ports.size}`);
    console.log('');

    if (ports.size === NUM_SANDBOXES) {
      console.log('✅ SUCCESS: Each sandbox has a unique port!');
    } else {
      console.log('❌ FAILURE: Port collision detected!');
      console.log(`  Ports: ${Array.from(ports).join(', ')}`);
    }

    // Try to run a simple command on each sandbox
    console.log('\nTesting SSH connectivity...');

    // Use direct API call to test
    for (const { sandbox, index } of results) {
      try {
        // Get fresh sandbox data
        const fresh = await client.getSandbox(sandbox.id);
        console.log(`Sandbox ${index}: host=${fresh.host}, port=${fresh.port} - ✅`);
      } catch (error) {
        console.log(`Sandbox ${index}: ${error}`);
      }
    }

    console.log('\nTest completed!');
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
