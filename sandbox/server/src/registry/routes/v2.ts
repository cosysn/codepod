/**
 * Docker Registry V2 API compatible routes
 * Implements the Docker Registry HTTP API V2 specification
 */

import { Router, Request, Response } from 'express';
import { RegistryService } from '../services/registry';
import { logger } from '../../logger';
import * as crypto from 'crypto';

const router = Router();
let registry: RegistryService | null = null;

function getRegistry(): RegistryService {
  if (!registry) {
    const storageRoot = process.env.CODEPOD_REGISTRY_STORAGE || './data/registry';
    registry = new RegistryService(storageRoot);
  }
  return registry;
}

// Helper to extract path after /v2
function extractPath(req: Request): string {
  let path = req.originalUrl.replace(/^\/v2/, '');
  if (path.startsWith('/')) path = path.substring(1);
  return path;
}

// GET /v2 - API version check (mounted at /v2)
router.get('/', async (req: Request, res: Response) => {
  res.set('Docker-Distribution-API-Version', 'registry/2.0');
  res.json({
    version: '2.0',
    name: 'codepod-registry',
  });
});

// GET /v2/_catalog - List repositories
router.get('/_catalog', async (req: Request, res: Response) => {
  try {
    const r = getRegistry();
    const repos = await r.listRepositories();
    res.json({ repositories: repos });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ errors: [{ code: 'INTERNAL_ERROR', message }] });
  }
});

// Unified handler for all other routes
router.all('*', async (req: Request, res: Response) => {
  const path = extractPath(req);
  const method = req.method;

  logger.debug(`${method} /v2/${path}`);

  try {
    // Route: <name>/tags/list - List tags
    if (path.endsWith('/tags/list') && (method === 'GET' || method === 'HEAD')) {
      const name = path.replace(/\/tags\/list$/, '');
      const r = getRegistry();

      const repos = await r.listRepositories();
      if (!repos.includes(name)) {
        return res.status(404).json({ errors: [{ code: 'NAME_UNKNOWN', message: `Repository ${name} not found` }] });
      }

      const tags = await r.listTags(name);
      return res.json({ name, tags });
    }

    // Route: <name>/manifests/<ref> - Get/Put/Delete manifest
    if (path.includes('/manifests/')) {
      const segments = path.split('/manifests/');
      const name = segments[0];
      const ref = segments[1];

      const r = getRegistry();

      // GET - Pull manifest
      if (method === 'GET' || method === 'HEAD') {
        try {
          const manifest = await r.pullManifest(name, ref);
          const mediaType = manifest.mediaType || 'application/vnd.oci.image.manifest.v1+json';
          res.set('Content-Type', mediaType);
          res.set('Docker-Content-Digest', `sha256:${crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex')}`);
          return res.json(manifest);
        } catch {
          return res.status(404).json({ errors: [{ code: 'MANIFEST_UNKNOWN', message: 'Manifest not found' }] });
        }
      }

      // PUT - Push manifest
      if (method === 'PUT') {
        let manifest: any;
        try {
          if (Buffer.isBuffer(req.body)) {
            manifest = JSON.parse(req.body.toString());
          } else if (typeof req.body === 'string') {
            manifest = JSON.parse(req.body);
          } else {
            manifest = req.body;
          }
        } catch (e) {
          return res.status(400).json({ errors: [{ code: 'MANIFEST_INVALID', message: 'Failed to parse manifest JSON' }] });
        }

        // Accept both Docker v2 and OCI manifest formats
        // Docker v2: schemaVersion, config, layers
        // OCI: schemaVersion, mediaType, config, layers
        const hasConfig = manifest && (manifest.config || manifest.data);  // config or legacy data field
        const hasLayers = manifest && manifest.layers;

        if (!hasConfig || !hasLayers) {
          return res.status(400).json({ errors: [{ code: 'MANIFEST_INVALID', message: 'Invalid manifest format: missing config or layers' }] });
        }

        await r.pushManifest(name, ref, manifest as any);
        const digest = `sha256:${crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex')}`;
        res.set('Docker-Content-Digest', digest);
        return res.status(201).json({ digest });
      }

      // DELETE - Delete manifest
      if (method === 'DELETE') {
        await r.deleteManifest(name, ref);
        return res.status(202).json({ message: 'Manifest deleted' });
      }
    }

    // Route: <name>/blobs/<digest> - Get blob
    if (path.includes('/blobs/') && !path.includes('/blobs/uploads/')) {
      const segments = path.split('/blobs/');
      const name = segments[0];
      const digest = segments[1];

      const r = getRegistry();

      // HEAD - Check blob exists
      if (method === 'HEAD') {
        const exists = await r.blobExists(digest);
        if (exists) {
          res.set('Docker-Content-Digest', digest);
          return res.status(200).end();
        }
        return res.status(404).end();
      }

      // GET - Pull blob
      if (method === 'GET') {
        try {
          const blob = await r.getBlob(digest);
          res.set('Content-Type', 'application/octet-stream');
          res.set('Docker-Content-Digest', digest);
          return res.send(blob);
        } catch {
          return res.status(404).json({ errors: [{ code: 'BLOB_UNKNOWN', message: 'Blob not found' }] });
        }
      }
    }

    // Route: <name>/blobs/uploads - Initiate blob upload
    if (path.includes('/blobs/uploads')) {
      // Strip query string from path
      const pathWithoutQuery = path.split('?')[0];
      const name = pathWithoutQuery.replace(/\/blobs\/uploads\/?$/, '');

      // POST - Initiate upload
      if (method === 'POST') {
        const uploadId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
        const baseUrl = `${req.protocol}://${req.get('host')}`;

        res.status(202);
        res.set('Location', `${baseUrl}/v2/${name}/blobs/uploads/${uploadId}`);
        res.set('Docker-Upload-UUID', uploadId);
        return res.json({
          uploadUrl: `${baseUrl}/v2/${name}/blobs/uploads/${uploadId}`,
          digest: '',
        });
      }

      // PUT - Complete upload with digest
      if (method === 'PUT') {
        logger.debug(`PUT blob upload: ${path}`);
        // Use path without query for extracting name and id
        const pathWithoutQuery = path.split('?')[0];
        const nameEndIndex = pathWithoutQuery.indexOf('/blobs/uploads/');
        const uploadName = pathWithoutQuery.substring(0, nameEndIndex);
        const id = pathWithoutQuery.substring(nameEndIndex + '/blobs/uploads/'.length);

        // Extract digest from query string
        const url = new URL(req.url, `http://${req.get('host')}`);
        const digest = url.searchParams.get('digest');
        logger.debug(`PUT digest from query: ${digest}`);

        const r = getRegistry();

        // If there's content in the body, store it
        let content: Buffer;
        if (Buffer.isBuffer(req.body) && req.body.length > 0) {
          content = req.body;
        } else if (typeof req.body === 'string' && req.body.length > 0) {
          content = Buffer.from(req.body);
        } else {
          // No content - this is a completion request
          // The blob should already be stored via PATCH
          content = Buffer.from('');
        }

        if (content.length > 0) {
          const storedDigest = await r.storeBlob(content);
          res.status(201);
          res.set('Docker-Content-Digest', storedDigest);
          return res.json({ digest: storedDigest });
        } else if (digest) {
          // Return success with the expected digest
          res.status(201);
          res.set('Docker-Content-Digest', digest);
          return res.json({ digest });
        } else {
          // No content and no digest - error
          return res.status(400).json({ errors: [{ code: 'BLOB_UPLOAD_INVALID', message: 'No content or digest provided' }] });
        }
      }

      // PATCH - Chunk upload
      if (method === 'PATCH') {
        // Use path without query for extracting name and id
        const pathWithoutQuery = path.split('?')[0];
        const nameEndIndex = pathWithoutQuery.indexOf('/blobs/uploads/');
        const uploadName = pathWithoutQuery.substring(0, nameEndIndex);
        const id = pathWithoutQuery.substring(nameEndIndex + '/blobs/uploads/'.length);

        // Get blob content from request body
        let content: Buffer;
        if (Buffer.isBuffer(req.body)) {
          content = req.body;
        } else if (typeof req.body === 'string') {
          content = Buffer.from(req.body);
        } else {
          content = Buffer.from('');
        }

        // Store the blob content temporarily (in real implementation, would track upload ID)
        const r = getRegistry();
        const digest = await r.storeBlob(content);

        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const locationUrl = `${baseUrl}/v2/${uploadName}/blobs/uploads/${id}`;

        // For monolithic upload (single PATCH with full content), return 201 Created
        res.status(201);
        res.set('Location', locationUrl);
        res.set('Docker-Content-Digest', digest);
        return res.end();
      }
    }

    // No route matched
    return res.status(404).json({ errors: [{ code: 'NOT_FOUND', message: 'Route not found', path }] });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Registry error: %s', message);
    return res.status(500).json({ errors: [{ code: 'INTERNAL_ERROR', message }] });
  }
});

export { router as v2Router };
