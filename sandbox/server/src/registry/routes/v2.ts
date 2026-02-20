/**
 * Docker Registry V2 API compatible routes
 * Implements the Docker Registry HTTP API V2 specification
 */

import { Router, Request, Response } from 'express';
import { RegistryService } from '../services/registry';
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

// GET /v2/ - API version check
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

// GET /v2/<name>/tags/list - List tags for image
router.get('/:name/tags/list', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const r = getRegistry();

    // Check if repository exists
    const repos = await r.listRepositories();
    if (!repos.includes(name)) {
      return res.status(404).json({ errors: [{ code: 'NAME_UNKNOWN', message: `Repository ${name} not found` }] });
    }

    const tags = await r.listTags(name);
    res.json({ name, tags });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(404).json({ errors: [{ code: 'NAME_UNKNOWN', message }] });
  }
});

// GET /v2/<name>/manifests/<ref> - Get manifest
router.get('/:name/manifests/:ref', async (req: Request, res: Response) => {
  try {
    const { name, ref } = req.params;
    const r = getRegistry();
    const manifest = await r.pullManifest(name, ref);

    // Set content type based on manifest media type
    const mediaType = manifest.mediaType || 'application/vnd.oci.image.manifest.v1+json';
    res.set('Content-Type', mediaType);
    res.set('Docker-Content-Digest', `sha256:${crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex')}`);
    res.json(manifest);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(404).json({ errors: [{ code: 'MANIFEST_UNKNOWN', message }] });
  }
});

// PUT /v2/<name>/manifests/<ref> - Push manifest
router.put('/:name/manifests/:ref', async (req: Request, res: Response) => {
  try {
    const { name, ref } = req.params;
    const r = getRegistry();

    // Parse manifest from body
    let manifest: any;
    if (Buffer.isBuffer(req.body)) {
      manifest = JSON.parse(req.body.toString());
    } else if (typeof req.body === 'string') {
      manifest = JSON.parse(req.body);
    } else {
      manifest = req.body;
    }

    // Validate manifest
    if (!manifest.schemaVersion || !manifest.config || !manifest.layers) {
      return res.status(400).json({ errors: [{ code: 'MANIFEST_INVALID', message: 'Invalid manifest format' }] });
    }

    await r.pushManifest(name, ref, manifest as any);

    // Calculate digest for response
    const digest = `sha256:${crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex')}`;
    res.set('Docker-Content-Digest', digest);
    res.status(201);
    res.json({ digest });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ errors: [{ code: 'INTERNAL_ERROR', message }] });
  }
});

// HEAD /v2/<name>/blobs/<digest> - Check blob exists
router.head('/:name/blobs/:digest', async (req: Request, res: Response) => {
  try {
    const { digest } = req.params;
    const r = getRegistry();
    const exists = await r.blobExists(digest);

    if (exists) {
      res.set('Docker-Content-Digest', digest);
      res.status(200).end();
    } else {
      res.status(404).end();
    }
  } catch (error: unknown) {
    res.status(500).end();
  }
});

// GET /v2/<name>/blobs/<digest> - Get blob
router.get('/:name/blobs/:digest', async (req: Request, res: Response) => {
  try {
    const { digest } = req.params;
    const r = getRegistry();
    const blob = await r.getBlob(digest);

    res.set('Content-Type', 'application/octet-stream');
    res.set('Docker-Content-Digest', digest);
    res.send(blob);
  } catch (error: unknown) {
    res.status(404).json({ errors: [{ code: 'BLOB_UNKNOWN', message: 'Blob not found' }] });
  }
});

// POST /v2/<name>/blobs/uploads/ - Initiate blob upload
router.post('/:name/blobs/uploads/', async (req: Request, res: Response) => {
  const { name } = req.params;
  const uploadId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;

  res.status(202);
  res.set('Location', `/v2/${name}/blobs/uploads/${uploadId}`);
  res.set('Docker-Upload-UUID', uploadId);
  res.json({
    uploadUrl: `/v2/${name}/blobs/uploads/${uploadId}`,
    digest: '',
  });
});

// PUT /v2/<name>/blobs/uploads/<id> - Upload blob
router.put('/:name/blobs/uploads/:id', async (req: Request, res: Response) => {
  try {
    const { name, id } = req.params;
    const r = getRegistry();

    // Get raw body - Express by default doesn't parse raw bodies
    // For supertest, body is typically already a buffer or string
    let content: Buffer;

    if (Buffer.isBuffer(req.body)) {
      content = req.body;
    } else if (typeof req.body === 'string') {
      content = Buffer.from(req.body);
    } else {
      // Try to extract from content property (JSON body)
      const body = req.body as { content?: string };
      if (body && body.content) {
        content = Buffer.from(body.content, 'base64');
      } else {
        content = Buffer.from('');
      }
    }

    const digest = await r.storeBlob(content);
    res.status(201);
    res.set('Docker-Content-Digest', digest);
    res.json({ digest });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ errors: [{ code: 'INTERNAL_ERROR', message }] });
  }
});

// DELETE /v2/<name>/manifests/<ref> - Delete manifest
router.delete('/:name/manifests/:ref', async (req: Request, res: Response) => {
  try {
    const { name, ref } = req.params;
    const r = getRegistry();
    await r.deleteManifest(name, ref);

    res.status(202);
    res.json({ message: 'Manifest deleted' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ errors: [{ code: 'INTERNAL_ERROR', message }] });
  }
});

// PATCH /v2/<name>/blobs/uploads/<id> - Upload blob chunk (stub)
router.patch('/:name/blobs/uploads/:id', async (req: Request, res: Response) => {
  const { name, id } = req.params;

  res.status(202);
  res.set('Location', `/v2/${name}/blobs/uploads/${id}`);
  res.set('Docker-Upload-UUID', id);
  res.json({
    uploadUrl: `/v2/${name}/blobs/uploads/${id}`,
    digest: '',
  });
});

export { router as v2Router };
