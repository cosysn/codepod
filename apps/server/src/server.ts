/**
 * HTTP Server with REST API routes
 */

import { IncomingMessage, ServerResponse, createServer as httpCreateServer } from 'http';
import { sandboxService } from './services/sandbox';
import { createJob, getPendingJobs, assignJob, completeJob, getAllJobs } from './services/job';
import { store } from './db/store';
import { Sandbox, CreateSandboxRequest, ErrorResponse, SandboxStatus } from './types';
import { GrpcServer } from './grpc/server';
import { sshCAService } from './services/ssh-ca';

const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';

let grpcServer: GrpcServer;

// Simple UUID generator
function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Parse JSON body
async function parseBody(req: IncomingMessage): Promise<unknown | null> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      if (!body) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// Send JSON response
function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, X-Runner-Id',
  });
  res.end(JSON.stringify(data));
}

// Send error response
function sendError(res: ServerResponse, code: number, message: string, details?: string): void {
  const error: ErrorResponse = { code, message, details };
  sendJson(res, code, error);
}

// Parse query parameters
function parseQuery(url: string): Record<string, string> {
  const params: Record<string, string> = {};
  const queryIndex = url.indexOf('?');
  if (queryIndex === -1) return params;

  const query = url.slice(queryIndex + 1);
  const pairs = query.split('&');
  for (const pair of pairs) {
    const [key, value] = pair.split('=');
    if (key) {
      params[decodeURIComponent(key)] = decodeURIComponent(value || '');
    }
  }
  return params;
}

// API Key authentication middleware
async function authenticate(req: IncomingMessage): Promise<boolean> {
  const apiKey = req.headers['x-api-key'] as string;
  if (!apiKey) return false;

  return store.validateAPIKey(apiKey) !== undefined;
}

// Request handler
async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url || '/';
  const method = req.method || 'GET';
  const path = url.split('?')[0];

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, X-Runner-Id',
    });
    res.end();
    return;
  }

  // Health check (no auth required)
  if (path === '/health' && method === 'GET') {
    sendJson(res, 200, { status: 'ok', timestamp: new Date().toISOString() });
    return;
  }

  // API routes
  try {
    // Sandbox routes
    if (path === '/api/v1/sandboxes' && method === 'POST') {
      const body = await parseBody(req);
      if (!body || typeof body !== 'object') {
        sendError(res, 400, 'Missing request body');
        return;
      }

      const result = sandboxService.create(body as CreateSandboxRequest);
      store.log('CREATE', 'sandbox', result.sandbox.id, undefined, { image: result.sandbox.image });
      sendJson(res, 201, result);
      return;
    }

    if (path === '/api/v1/sandboxes' && method === 'GET') {
      const result = sandboxService.list();
      sendJson(res, 200, result);
      return;
    }

    // Agent status update endpoint (must be before generic :id routes)
    const statusMatch = path.match(/^\/api\/v1\/sandboxes\/([a-zA-Z0-9-]+)\/status$/);
    if (statusMatch && method === 'POST') {
      const sandboxId = statusMatch[1];
      const body = await parseBody(req);
      const data = body as {
        status: string;
        cpuPercent?: number;
        memoryMB?: number;
        sessionCount?: number;
      };

      const sandbox = store.getSandbox(sandboxId);
      if (!sandbox) {
        sendError(res, 404, 'Sandbox not found');
        return;
      }

      // Update agent info
      store.updateAgentInfo(sandboxId, {
        metrics: {
          cpuPercent: data.cpuPercent,
          memoryMB: data.memoryMB,
          sessionCount: data.sessionCount,
        }
      });

      // If status is stopped, update sandbox status
      if (data.status === 'stopped') {
        store.updateSandbox(sandboxId, { status: 'stopped' });
      }

      sendJson(res, 200, { success: true, sandboxId });
      return;
    }

    // Runner status update endpoint
    const runnerStatusMatch = path.match(/^\/api\/v1\/sandboxes\/([a-zA-Z0-9-]+)\/runner-status$/);
    if (runnerStatusMatch && method === 'POST') {
      const sandboxId = runnerStatusMatch[1];
      const runnerId = req.headers['x-runner-id'] as string;

      if (!runnerId) {
        sendError(res, 400, 'Missing X-Runner-Id header');
        return;
      }

      const body = await parseBody(req);
      const data = body as {
        status: SandboxStatus;
        containerId?: string;
        port?: number;
        host?: string;
        message?: string;
      };

      const sandbox = store.getSandbox(sandboxId);
      if (!sandbox) {
        sendError(res, 404, 'Sandbox not found');
        return;
      }

      // Verify this sandbox is assigned to this runner
      if (sandbox.runnerId && sandbox.runnerId !== runnerId) {
        sendError(res, 403, 'Sandbox is assigned to a different runner');
        return;
      }

      // Update sandbox status
      store.updateSandboxRunnerStatus(sandboxId, {
        runnerId,
        containerId: data.containerId,
        port: data.port,
        host: data.host,
        sandboxStatus: data.status,
      });

      // Log the status change
      store.log('UPDATE', 'sandbox', sandboxId, runnerId, {
        status: data.status,
        message: data.message,
      });

      sendJson(res, 200, { success: true, sandboxId, status: data.status });
      return;
    }

    if (path.startsWith('/api/v1/sandboxes/') && method === 'GET') {
      const id = path.split('/').pop();
      if (!id) {
        sendError(res, 400, 'Missing sandbox ID');
        return;
      }

      const sandbox = sandboxService.get(id);
      if (!sandbox) {
        sendError(res, 404, 'Sandbox not found');
        return;
      }

      sendJson(res, 200, { sandbox });
      return;
    }

    if (path.startsWith('/api/v1/sandboxes/') && method === 'DELETE') {
      const id = path.split('/').pop();
      if (!id) {
        sendError(res, 400, 'Missing sandbox ID');
        return;
      }

      // Check if sandbox exists
      const sandbox = sandboxService.get(id);
      if (!sandbox) {
        sendError(res, 404, 'Sandbox not found');
        return;
      }

      // If sandbox is running, create delete job for runner
      if (sandbox.status === 'running' || sandbox.status === 'pending') {
        createJob({
          type: 'delete',
          sandboxId: id,
          image: sandbox.image,
          token: sandbox.token || '',
        });
        // Update status to deleting
        sandboxService.updateStatus(id, 'deleting');
      } else {
        // If not running, just delete from database
        sandboxService.delete(id);
      }

      sendJson(res, 200, { success: true });
      return;
    }

    if (path.startsWith('/api/v1/sandboxes/') && path.endsWith('/token') && method === 'POST') {
      const parts = path.split('/');
      const id = parts[parts.length - 2];
      if (!id) {
        sendError(res, 400, 'Missing sandbox ID');
        return;
      }

      const token = sandboxService.getConnectionToken(id);
      if (!token) {
        sendError(res, 404, 'Sandbox not found');
        return;
      }

      sendJson(res, 200, { token });
      return;
    }

    // Stats route
    if (path === '/api/v1/stats' && method === 'GET') {
      const stats = sandboxService.getStats();
      const storeStats = store.getStats();
      sendJson(res, 200, { ...stats, ...storeStats });
      return;
    }

    // API Keys routes (for testing)
    if (path === '/api/v1/keys' && method === 'POST') {
      const body = await parseBody(req);
      const name = (body as Record<string, unknown>)?.name || 'default';
      const apiKey = store.createAPIKey({ name: String(name) });
      sendJson(res, 201, { key: apiKey.key, id: apiKey.id });
      return;
    }

    if (path === '/api/v1/keys' && method === 'GET') {
      const keys = store.listAPIKeys();
      sendJson(res, 200, { keys });
      return;
    }

    if (path.startsWith('/api/v1/keys/') && method === 'DELETE') {
      const id = path.split('/').pop();
      if (!id) {
        sendError(res, 400, 'Missing key ID');
        return;
      }
      const deleted = store.deleteAPIKey(id);
      if (!deleted) {
        sendError(res, 404, 'Key not found');
        return;
      }
      sendJson(res, 200, { success: true });
      return;
    }

    // Audit logs
    if (path === '/api/v1/audit' && method === 'GET') {
      const logs = store.getAuditLogs({ limit: 100 });
      sendJson(res, 200, { logs });
      return;
    }

    // Runner registration routes
    if (path === '/api/v1/runners/register' && method === 'POST') {
      const body = await parseBody(req);
      const data = body as Record<string, unknown>;
      const runnerId = data.id as string;
      const capacity = data.capacity as number || 10;

      if (!runnerId) {
        sendError(res, 400, 'Missing runner ID');
        return;
      }

      const runner = {
        id: runnerId,
        address: '', // Will be populated from request
        capacity,
        status: 'available' as const,
      };

      grpcServer.registerRunner(runner);
      sendJson(res, 200, { success: true, runnerId });
      return;
    }

    // Job routes for runner polling
    if (path === '/api/v1/jobs' && method === 'GET') {
      const runnerId = req.headers['x-runner-id'] as string;
      const pendingJobs = getPendingJobs(runnerId);
      sendJson(res, 200, { jobs: pendingJobs });
      return;
    }

    if (path === '/api/v1/jobs' && method === 'POST') {
      const body = await parseBody(req);
      if (!body || typeof body !== 'object') {
        sendError(res, 400, 'Missing request body');
        return;
      }

      const data = body as Record<string, unknown>;
      const job = createJob({
        type: data.type as 'create' | 'delete',
        sandboxId: data.sandboxId as string,
        image: data.image as string,
        token: data.token as string || '',
      });
      sendJson(res, 201, { job });
      return;
    }

    if (path.startsWith('/api/v1/jobs/') && path.endsWith('/accept') && method === 'POST') {
      const jobId = path.split('/')[4];
      if (!jobId) {
        sendError(res, 400, 'Missing job ID');
        return;
      }
      const runnerId = req.headers['x-runner-id'] as string;
      if (!runnerId) {
        sendError(res, 400, 'Missing X-Runner-Id header');
        return;
      }
      const success = assignJob(jobId, runnerId);
      sendJson(res, 200, { success });
      return;
    }

    // Complete job endpoint
    const completeMatch = path.match(/^\/api\/v1\/jobs\/([^\/]+)\/complete$/);
    if (completeMatch && method === 'POST') {
      const jobId = completeMatch[1];
      const runnerId = req.headers['x-runner-id'] as string;
      if (!runnerId) {
        sendError(res, 400, 'Missing X-Runner-Id header');
        return;
      }

      const body = await parseBody(req);
      const data = body as { success?: boolean; message?: string };

      const success = data.success !== false;
      const message = data.message || (success ? 'Job completed' : 'Job failed');

      completeJob(jobId, success);
      store.log('COMPLETE', 'job', jobId, runnerId, { success, message });
      sendJson(res, 200, { success, message });
      return;
    }

    if (path === '/api/v1/all-jobs' && method === 'GET') {
      const allJobs = getAllJobs();
      sendJson(res, 200, { jobs: allJobs });
      return;
    }

    // SSH CA routes
    // Get CA public key (for agent configuration)
    if (path === '/api/v1/ssh/ca' && method === 'GET') {
      try {
        const caPublicKey = sshCAService.getCAPublicKey();
        // Return as plain text to preserve newlines
        res.writeHead(200, {
          'Content-Type': 'text/plain',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(caPublicKey);
      } catch (e) {
        sendError(res, 500, 'Failed to get CA public key', String(e));
      }
      return;
    }

    // Sign public key to create certificate
    if (path === '/api/v1/ssh/cert' && method === 'POST') {
      const body = await parseBody(req);
      const data = body as Record<string, unknown>;

      console.log('Received cert request:', JSON.stringify(data));

      const publicKeyPem = data.publicKey as string;
      const sandboxId = data.sandboxId as string;
      const validitySeconds = (data.validitySeconds as number) || 3600;

      if (!publicKeyPem) {
        sendError(res, 400, 'Missing publicKey');
        return;
      }

      if (!sandboxId) {
        sendError(res, 400, 'Missing sandboxId');
        return;
      }

      // Verify sandbox exists and user has access
      const sandbox = store.getSandbox(sandboxId);
      if (!sandbox) {
        sendError(res, 404, 'Sandbox not found');
        return;
      }

      try {
        const certificate = await sshCAService.signPublicKey(
          publicKeyPem,
          sandboxId,
          'root',
          validitySeconds
        );
        sendJson(res, 200, { certificate });
      } catch (e) {
        sendError(res, 500, 'Failed to sign certificate', String(e));
      }
      return;
    }

    // 404 for unknown routes
    sendError(res, 404, 'Not found');
  } catch (error) {
    console.error('Request error:', error);
    sendError(res, 500, 'Internal server error', String(error));
  }
}

// Create and start server
export function createServer(): { server: ReturnType<typeof httpCreateServer>; start: () => Promise<void> } {
  const server = httpCreateServer(handleRequest);

  // Cleanup task: check for dead sandboxes every 60 seconds
  function startCleanupTask(): void {
    setInterval(() => {
      const sandboxes = store.listSandboxes();
      const runningSandboxes = sandboxes.filter(s => s.status === 'running');

      for (const sb of runningSandboxes) {
        // If last heartbeat is older than 2 minutes, mark as stopped
        if (sb.agentInfo?.lastHeartbeat) {
          const lastHeartbeat = new Date(sb.agentInfo.lastHeartbeat);
          const now = new Date();
          const diffMinutes = (now.getTime() - lastHeartbeat.getTime()) / 60000;

          if (diffMinutes > 2) {
            console.log(`Sandbox ${sb.id} has no heartbeat for ${diffMinutes.toFixed(1)} minutes, marking as stopped`);
            store.updateSandbox(sb.id, { status: 'stopped' });
          }
        }
      }
    }, 60000); // Check every 60 seconds
  }

  const start = async (): Promise<void> => {
    // Initialize SSH CA
    await sshCAService.initialize();
    console.log('SSH CA initialized');

    // Start cleanup task
    startCleanupTask();
    console.log('Cleanup task started');

    // Create and start gRPC server
    grpcServer = new GrpcServer(50051);
    grpcServer.start().catch(console.error);

    server.listen(PORT, HOST, () => {
      console.log(`CodePod Server running at http://${HOST}:${PORT}`);
    });
  };

  return { server, start };
}

// Start server if run directly
if (require.main === module) {
  const { start } = createServer();
  start();
}
