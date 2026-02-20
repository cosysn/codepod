/**
 * Registry HTTP Server using Express
 * Runs on a separate port for Docker Registry V2 API compatibility
 */

import express from 'express';
import { imagesRouter, tagsRouter, v2Router } from './routes';

const PORT = parseInt(process.env.CODEPOD_REGISTRY_PORT || '5000', 10);
const HOST = process.env.CODEPOD_REGISTRY_HOST || '0.0.0.0';

const app = express();

// Enable raw body parsing for blob uploads
app.use(express.raw({ type: '*/*', limit: '10gb' }));

// JSON parsing for other routes
app.use(express.json());

// Mount registry routes
app.use('/api/v1/registry/images', imagesRouter);
app.use('/api/v1/registry/tags', tagsRouter);
app.use('/v2', v2Router);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', module: 'registry' });
});

// Start server
const server = app.listen(PORT, HOST, () => {
  console.log(`Registry server listening on ${HOST}:${PORT}`);
});

export { app, server };
