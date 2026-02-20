/**
 * Tags API routes for registry tag management
 */

import { Router, Request, Response } from 'express';
import { RegistryService } from '../services/registry';

const router = Router();
let registry: RegistryService | null = null;

function getRegistry(): RegistryService {
  if (!registry) {
    const storageRoot = process.env.CODEPOD_REGISTRY_STORAGE || './data/registry';
    registry = new RegistryService(storageRoot);
  }
  return registry;
}

// GET /api/v1/registry/tags - List all tags with image names
router.get('/', async (req: Request, res: Response) => {
  try {
    const r = getRegistry();
    const repos = await r.listRepositories();
    const tags: Array<{ name: string; tag: string }> = [];

    for (const repo of repos) {
      const repoTags = await r.listTags(repo);
      for (const tag of repoTags) {
        tags.push({ name: `${repo}:${tag}`, tag });
      }
    }

    res.json({ tags });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

// GET /api/v1/registry/tags/:name - Get tag details (manifest)
router.get('/:name', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;

    // Parse name as repo:tag
    const [repo, tag] = name.split(':');
    if (!tag) {
      return res.status(400).json({ error: 'Invalid tag name, use format: repo:tag' });
    }

    const r = getRegistry();
    const manifest = await r.pullManifest(repo, tag);
    res.json({ name: `${repo}:${tag}`, manifest });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(404).json({ error: message });
  }
});

// DELETE /api/v1/registry/tags/:name - Delete tag
router.delete('/:name', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const [repo, tag] = name.split(':');

    if (!tag) {
      return res.status(400).json({ error: 'Invalid tag name, use format: repo:tag' });
    }

    const r = getRegistry();
    await r.deleteManifest(repo, tag);
    res.json({ message: `Tag ${name} deleted` });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

export { router as tagsRouter };
