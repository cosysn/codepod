/**
 * Images API routes for registry management
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

// GET /api/v1/registry/images - List all repositories
router.get('/', async (req: Request, res: Response) => {
  try {
    const r = getRegistry();
    const repos = await r.listRepositories();
    res.json({ images: repos });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

// GET /api/v1/registry/images/:name - Get image details
router.get('/:name', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const r = getRegistry();
    const tags = await r.listTags(name);
    res.json({ name, tags });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(404).json({ error: message });
  }
});

// DELETE /api/v1/registry/images/:name - Delete image and all its tags
router.delete('/:name', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const r = getRegistry();

    // Get all tags and delete each
    const tags = await r.listTags(name);
    for (const tag of tags) {
      await r.deleteManifest(name, tag);
    }

    res.json({ message: `Image ${name} deleted`, deletedTags: tags.length });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

export { router as imagesRouter };
