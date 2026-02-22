/**
 * HTTP Server with REST API routes
 */

import express, { Request, Response, NextFunction } from 'express';
import { createServer as httpCreateServer, IncomingMessage, ServerResponse } from 'http';
import { createServer as httpsCreateServer } from 'https';
import * as fs from 'fs';
import * as path from 'path';
import { sandboxService } from './services/sandbox';
import { volumeService } from './services/volume';
import { createJob, getPendingJobs, assignJob, completeJob, getAllJobs } from './services/job';
import { store } from './db/store';
import { Sandbox, CreateSandboxRequest, ErrorResponse, SandboxStatus } from './types';
import { GrpcServer } from './grpc/server';
import { sshCAService } from './services/ssh-ca';
import { v2Router } from './registry/routes/v2';
import { createRegistryMiddleware } from './registry/proxy';
import { logger } from './logger';

const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';

let grpcServer: GrpcServer;

// Create Express app
const app = express();

// Check if using external registry proxy
const useExternalRegistry = !!process.env.CODEPOD_REGISTRY_URL;

// Raw body for registry blob uploads (must come before JSON parsing)
// Only use for built-in registry, external proxy handles it differently
if (!useExternalRegistry) {
  app.use('/v2', (req: Request, res: Response, next: NextFunction) => {
    logger.info(`${req.method} ${req.originalUrl}`);
    next();
  });
  app.use('/v2', express.raw({ type: '*/*', limit: '10gb' }));
}

// JSON parsing for API routes
app.use(express.json());

// CORS middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, X-Runner-Id, Accept');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

// Mount registry routes at /v2 (Docker Registry API standard)
// Check if we should use external registry proxy
const registryMiddleware = createRegistryMiddleware();
if (registryMiddleware) {
  // Use external registry proxy
  app.use('/v2', registryMiddleware);
} else {
  // Use built-in registry implementation
  // Note: v2Router handles image names with slashes (e.g., codepod/builder)
  // by using wildcard routes like /*/blobs/* and parsing the path directly
  app.use('/v2', v2Router);
}

// Test route to debug
app.get('/test', (req: Request, res: Response) => {
  res.json({ message: 'test route works' });
});

// Health check (no auth required)
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Simple UUID generator
function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Send error response
function sendError(res: Response, code: number, message: string, details?: string): void {
  const error: ErrorResponse = { code, message, details };
  res.status(code).json(error);
}

// API Key authentication middleware
async function authenticate(req: Request): Promise<boolean> {
  const apiKey = req.headers['x-api-key'] as string;
  if (!apiKey) return false;

  return store.validateAPIKey(apiKey) !== undefined;
}

// API routes handler - adapted for Express
async function handleAPIRequest(req: Request, res: Response): Promise<void> {
  const url = req.originalUrl;
  const method = req.method;
  const path = url.split('?')[0];

  // API routes - sandbox
  if (path === '/api/v1/sandboxes' && method === 'POST') {
    const body = req.body;
    if (!body || typeof body !== 'object') {
      sendError(res, 400, 'Missing request body');
      return;
    }

    const result = sandboxService.create(body as CreateSandboxRequest);
    store.log('CREATE', 'sandbox', result.sandbox.id, undefined, { image: result.sandbox.image });
    res.status(201).json(result);
    return;
  }

  if (path === '/api/v1/sandboxes' && method === 'GET') {
    const result = sandboxService.list();
    res.status(200).json(result);
    return;
  }

  // Agent status update endpoint (must be before generic :id routes)
  const statusMatch = path.match(/^\/api\/v1\/sandboxes\/([a-zA-Z0-9-]+)\/status$/);
  if (statusMatch && method === 'POST') {
    const sandboxId = statusMatch[1];
    const data = req.body as {
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

    res.status(200).json({ success: true, sandboxId });
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

    const data = req.body as {
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

    res.status(200).json({ success: true, sandboxId, status: data.status });
    return;
  }

  // Agent address update endpoint (push agent gRPC address from runner)
  const agentAddressMatch = path.match(/^\/api\/v1\/sandboxes\/([a-zA-Z0-9-]+)\/agent-address$/);
  if (agentAddressMatch && method === 'POST') {
    const sandboxId = agentAddressMatch[1];
    const runnerId = req.headers['x-runner-id'] as string;

    if (!runnerId) {
      sendError(res, 400, 'Missing X-Runner-Id header');
      return;
    }

    const data = req.body as {
      host?: string;
      port?: number;
      token?: string;
    };

    if (!data.host || !data.port) {
      sendError(res, 400, 'Missing host or port');
      return;
    }

    const sandbox = store.getSandbox(sandboxId);
    if (!sandbox) {
      sendError(res, 404, 'Sandbox not found');
      return;
    }

    // Update agent address info
    store.updateAgentAddress(sandboxId, {
      host: data.host,
      port: data.port,
      token: data.token,
    });

    // Log the agent address update
    store.log('UPDATE', 'sandbox', sandboxId, runnerId, {
      agentHost: data.host,
      agentPort: data.port,
    });

    res.status(200).json({ success: true, sandboxId });
    return;
  }

  // Connection info endpoint - get Agent's host:port and token
  const connectionMatch = path.match(/^\/api\/v1\/sandboxes\/([a-zA-Z0-9-]+)\/connection$/);
  if (connectionMatch && method === 'GET') {
    const sandboxId = connectionMatch[1];

    const sandbox = store.getSandbox(sandboxId);
    if (!sandbox) {
      sendError(res, 404, 'Sandbox not found');
      return;
    }

    // Return agent connection info
    const host = sandbox.agentInfo?.addressHost || sandbox.host;
    const port = sandbox.agentInfo?.addressPort || sandbox.port;
    const token = sandbox.agentInfo?.addressToken || sandbox.token;

    res.status(200).json({ host, port, token });
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

    res.status(200).json({ sandbox });
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

    res.status(200).json({ success: true });
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

    res.status(200).json({ token });
    return;
  }

  // Stats route
  if (path === '/api/v1/stats' && method === 'GET') {
    const stats = sandboxService.getStats();
    const storeStats = store.getStats();
    res.status(200).json({ ...stats, ...storeStats });
    return;
  }

  // API Keys routes (for testing)
  if (path === '/api/v1/keys' && method === 'POST') {
    const body = req.body;
    const name = (body as Record<string, unknown>)?.name || 'default';
    const apiKey = store.createAPIKey({ name: String(name) });
    res.status(201).json({ key: apiKey.key, id: apiKey.id });
    return;
  }

  if (path === '/api/v1/keys' && method === 'GET') {
    const keys = store.listAPIKeys();
    res.status(200).json({ keys });
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
    res.status(200).json({ success: true });
    return;
  }

  // Audit logs
  if (path === '/api/v1/audit' && method === 'GET') {
    const logs = store.getAuditLogs({ limit: 100 });
    res.status(200).json({ logs });
    return;
  }

  // Runner registration routes
  if (path === '/api/v1/runners/register' && method === 'POST') {
    const body = req.body;
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
    res.status(200).json({ success: true, runnerId });
    return;
  }

  // Job routes for runner polling
  if (path === '/api/v1/jobs' && method === 'GET') {
    const runnerId = req.headers['x-runner-id'] as string;
    const pendingJobs = getPendingJobs(runnerId);
    res.status(200).json({ jobs: pendingJobs });
    return;
  }

  if (path === '/api/v1/jobs' && method === 'POST') {
    const body = req.body;
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
    res.status(201).json({ job });
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
    res.status(200).json({ success });
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

    const data = req.body as { success?: boolean; message?: string };

    const success = data.success !== false;
    const message = data.message || (success ? 'Job completed' : 'Job failed');

    completeJob(jobId, success);
    store.log('COMPLETE', 'job', jobId, runnerId, { success, message });
    res.status(200).json({ success, message });
    return;
  }

  if (path === '/api/v1/all-jobs' && method === 'GET') {
    const allJobs = getAllJobs();
    res.status(200).json({ jobs: allJobs });
    return;
  }

  // Volume routes
  if (path === '/api/v1/volumes' && method === 'POST') {
    const body = req.body;
    if (!body || typeof body !== 'object') {
      sendError(res, 400, 'Missing request body');
      return;
    }

    const data = body as Record<string, unknown>;
    const reqData = {
      name: data.name as string,
      size: data.size as string,
    };

    try {
      const result = volumeService.create(reqData);
      store.log('CREATE', 'volume', result.volumeId, undefined, { name: reqData.name, size: reqData.size });
      res.status(201).json(result);
      return;
    } catch (e) {
      sendError(res, 400, (e as Error).message);
      return;
    }
  }

  if (path === '/api/v1/volumes' && method === 'GET') {
    const result = volumeService.list();
    res.status(200).json(result);
    return;
  }

  if (path.startsWith('/api/v1/volumes/') && method === 'GET') {
    const id = path.split('/').pop();
    if (!id) {
      sendError(res, 400, 'Missing volume ID');
      return;
    }

    const volume = volumeService.get(id);
    if (!volume) {
      sendError(res, 404, 'Volume not found');
      return;
    }

    res.status(200).json({ volume });
    return;
  }

  if (path.startsWith('/api/v1/volumes/') && method === 'DELETE') {
    const id = path.split('/').pop();
    if (!id) {
      sendError(res, 400, 'Missing volume ID');
      return;
    }

    const deleted = volumeService.delete(id);
    if (!deleted) {
      sendError(res, 404, 'Volume not found');
      return;
    }

    store.log('DELETE', 'volume', id);
    res.status(200).json({ success: true });
    return;
  }

  // SSH CA routes
  // Get CA public key (for agent configuration)
  if (path === '/api/v1/ssh/ca' && method === 'GET') {
    try {
      const caPublicKey = sshCAService.getCAPublicKey();
      // Return as plain text to preserve newlines
      res.status(200).type('text/plain').send(caPublicKey);
    } catch (e) {
      sendError(res, 500, 'Failed to get CA public key', String(e));
    }
    return;
  }

  // Sign public key to create certificate
  if (path === '/api/v1/ssh/cert' && method === 'POST') {
    const data = req.body as Record<string, unknown>;

    logger.info('Received cert request: %s', JSON.stringify(data));

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
      res.status(200).json({ certificate });
    } catch (e) {
      sendError(res, 500, 'Failed to sign certificate', String(e));
    }
    return;
  }

  // Cleanup endpoint: remove stuck sandboxes
  if (path === '/api/v1/cleanup' && method === 'POST') {
    const sandboxes = store.listSandboxes();
    const now = new Date();
    let cleaned = 0;

    for (const sb of sandboxes) {
      // Clean stuck deleting sandboxes
      if (sb.status === 'deleting') {
        const createdAt = new Date(sb.createdAt);
        const diffMinutes = (now.getTime() - createdAt.getTime()) / 60000;
        if (diffMinutes > 1) {
          store.deleteSandbox(sb.id);
          cleaned++;
        }
      }
    }

    res.status(200).json({ success: true, cleaned });
    return;
  }

  // 404 for unknown routes
  sendError(res, 404, 'Not found');
}

// Mount API routes
app.use('/api', (req: Request, res: Response) => {
  handleAPIRequest(req, res).catch((error) => {
    logger.error('Request error: %s', error);
    sendError(res, 500, 'Internal server error', String(error));
  });
});

// Create and start server
export function createServer(): { httpServer: ReturnType<typeof httpCreateServer> | undefined; httpsServer: ReturnType<typeof httpsCreateServer> | null; start: () => Promise<void> } {
  // Check for SSL certificates
  const certPath = process.env.SSL_CERT_PATH || path.join(process.cwd(), 'cert.pem');
  const keyPath = process.env.SSL_KEY_PATH || path.join(process.cwd(), 'key.pem');

  let httpServer: ReturnType<typeof httpCreateServer> | undefined;
  let httpsServer: ReturnType<typeof httpsCreateServer> | null = null;

  // Only start HTTPS server if certificates exist
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    const https = require('https');
    const sslOptions = {
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath),
    };
    httpsServer = httpsCreateServer(sslOptions, app);
    logger.info('HTTPS enabled');
  } else {
    // Fallback to HTTP
    httpServer = httpCreateServer(app);
    logger.info('HTTP only (no SSL certificates found)');
  }

  // Cleanup task: check for dead sandboxes every 60 seconds
  function startCleanupTask(): void {
    setInterval(() => {
      const sandboxes = store.listSandboxes();
      const now = new Date();

      // Check running sandboxes for stale heartbeat
      const runningSandboxes = sandboxes.filter(s => s.status === 'running');
      for (const sb of runningSandboxes) {
        if (sb.agentInfo?.lastHeartbeat) {
          const lastHeartbeat = new Date(sb.agentInfo.lastHeartbeat);
          const diffMinutes = (now.getTime() - lastHeartbeat.getTime()) / 60000;

          if (diffMinutes > 2) {
            logger.warn(`Sandbox ${sb.id} has no heartbeat for ${diffMinutes.toFixed(1)} minutes, marking as stopped`);
            store.updateSandbox(sb.id, { status: 'stopped' });
          }
        }
      }

      // Check deleting sandboxes - if stuck for 5+ minutes, delete from database
      const deletingSandboxes = sandboxes.filter(s => s.status === 'deleting');
      for (const sb of deletingSandboxes) {
        const createdAt = new Date(sb.createdAt);
        const diffMinutes = (now.getTime() - createdAt.getTime()) / 60000;

        if (diffMinutes > 5) {
          logger.warn(`Sandbox ${sb.id} stuck in deleting status for ${diffMinutes.toFixed(1)} minutes, removing from database`);
          store.deleteSandbox(sb.id);
        }
      }
    }, 60000); // Check every 60 seconds
  }

  const start = async (): Promise<void> => {
    // Initialize SSH CA
    await sshCAService.initialize();
    logger.info('SSH CA initialized');

    // Start cleanup task
    startCleanupTask();
    logger.info('Cleanup task started');

    // Create and start gRPC server
    grpcServer = new GrpcServer(50051);
    grpcServer.start().catch((err) => logger.error('gRPC server error: %s', err));

    // Start appropriate server
    if (httpsServer) {
      httpsServer.listen(PORT, HOST, () => {
        logger.info(`CodePod Server running at https://${HOST}:${PORT}`);
      });
    } else if (httpServer !== undefined) {
      httpServer.listen(PORT, HOST, () => {
        logger.info(`CodePod Server running at http://${HOST}:${PORT}`);
      });
    }
  };

  return { httpServer, httpsServer, start };
}

// Start server if run directly
if (require.main === module) {
  const { start } = createServer();
  start();
}
