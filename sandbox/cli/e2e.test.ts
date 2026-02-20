/**
 * E2E Tests for CLI with real Server
 */

import { spawn, ChildProcess } from 'child_process';
import * as http from 'http';
import * as path from 'path';

const SERVER_PORT = 18080;
const SERVER_URL = `http://localhost:${SERVER_PORT}`;
const CLI_PATH = path.join(__dirname, 'dist', 'index.js');

describe('E2E Tests', () => {
  let serverProcess: ChildProcess | null = null;
  let serverReady = false;

  // Start server before all tests
  beforeAll(async () => {
    // Kill any existing server on the port
    await killPort(SERVER_PORT);

    // Start server
    serverProcess = spawn('node', ['dist/index.js'], {
      cwd: path.join(__dirname, '..', 'server'),
      env: { ...process.env, PORT: String(SERVER_PORT) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Wait for server to be ready
    serverReady = await waitForServer(SERVER_URL, 10000);
    if (!serverReady) {
      throw new Error('Server failed to start');
    }
  }, 30000);

  afterAll(async () => {
    // Kill server
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    await killPort(SERVER_PORT);
  });

  describe('Server Health', () => {
    it('should respond to health check', async () => {
      const response = await makeRequest(`${SERVER_URL}/health`);
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('ok');
    });
  });

  describe('CLI Commands', () => {
    it('should list sandboxes (empty or with data)', async () => {
      const result = await runCLI(['list'], SERVER_URL);
      expect(result.exitCode).toBe(0);
      // Should contain either empty message or table with data
      expect(
        result.stdout.includes('No sandboxes found') ||
        result.stdout.includes('ID')
      ).toBe(true);
    });

    it('should create a sandbox', async () => {
      const result = await runCLI(['create', 'ubuntu:20.04'], SERVER_URL);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Sandbox created successfully');
    });

    it('should list sandboxes after creation', async () => {
      const result = await runCLI(['list'], SERVER_URL);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('ubuntu:20.04');
    });

    it('should get sandbox details via ssh command', async () => {
      // First list to get an ID
      const listResult = await runCLI(['list'], SERVER_URL);
      expect(listResult.stdout).toContain('ubuntu:20.04');

      // Extract ID from the list output
      const idMatch = listResult.stdout.match(/ID:\s+([a-f0-9-]+)/);
      if (idMatch) {
        const sshResult = await runCLI(['ssh', idMatch[1]], SERVER_URL);
        expect(sshResult.exitCode).toBe(0);
        expect(sshResult.stdout).toContain('Token:');
      }
    });

    it('should handle non-existent sandbox', async () => {
      const result = await runCLI(['ssh', 'non-existent-id'], SERVER_URL);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('404');
    });
  });
});

// Helper: Kill process on port
async function killPort(port: number): Promise<void> {
  try {
    await new Promise<void>((resolve) => {
      const req = http.get(`http://localhost:${port}/health`, (res) => {
        res.resume();
        res.on('end', () => {
          spawn('pkill', ['-f', `node.*server.*${port}`]);
          setTimeout(resolve, 500);
        });
      });
      req.on('error', () => resolve());
      req.setTimeout(1000, () => {
        req.destroy();
        resolve();
      });
    });
  } catch {
    // Ignore errors
  }
}

// Helper: Wait for server to be ready
async function waitForServer(url: string, timeout: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.get(`${url}/health`, (res) => {
          if (res.statusCode === 200) {
            resolve();
          } else {
            reject(new Error(`Status ${res.statusCode}`));
          }
        });
        req.on('error', reject);
        req.setTimeout(1000, () => {
          req.destroy();
          reject(new Error('Timeout'));
        });
      });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return false;
}

// Helper: Make HTTP request
function makeRequest(url: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode || 500, body }));
    }).on('error', reject);
  });
}

// Helper: Run CLI command
async function runCLI(
  args: string[],
  endpoint: string
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('node', [CLI_PATH, ...args], {
      env: { ...process.env, ENDPOINT: endpoint },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({ exitCode: code || 0, stdout, stderr });
    });

    child.on('error', (err) => {
      resolve({ exitCode: 1, stdout: '', stderr: err.message });
    });
  });
}
