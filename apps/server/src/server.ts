/**
 * HTTP Server with REST API routes
 */

import { IncomingMessage, ServerResponse, createServer as httpCreateServer } from 'http';
import { sandboxService } from './services/sandbox';
import { store } from './db/store';
import { Sandbox, CreateSandboxRequest, ErrorResponse } from './types';

const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';

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
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
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
      'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
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

      const deleted = sandboxService.delete(id);
      if (!deleted) {
        sendError(res, 404, 'Sandbox not found');
        return;
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

    // 404 for unknown routes
    sendError(res, 404, 'Not found');
  } catch (error) {
    console.error('Request error:', error);
    sendError(res, 500, 'Internal server error', String(error));
  }
}

// Create and start server
export function createServer(): { server: ReturnType<typeof httpCreateServer>; start: () => void } {
  const server = httpCreateServer(handleRequest);

  const start = (): void => {
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
