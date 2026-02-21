/**
 * Registry Proxy - forwards Docker Registry API requests to external registry
 * Using express-http-proxy for reliable HTTP/HTTPS proxying
 */

import proxy from 'express-http-proxy';
import { Request } from 'express';
import { logger } from '../logger';

/**
 * Create registry proxy middleware
 */
export function createRegistryProxy(registryUrl: string) {
  return proxy(registryUrl, {
    // Proxy all requests including blob uploads
    filter: (req: Request) => true,

    // Return the original URL path for Docker Registry API
    proxyReqPathResolver: (req: Request) => {
      return Promise.resolve(req.originalUrl);
    },
  });
}

/**
 * Create registry middleware based on configuration
 */
export function createRegistryMiddleware() {
  const registryUrl = process.env.CODEPOD_REGISTRY_URL;

  if (!registryUrl) {
    // No external registry configured, will use built-in implementation
    logger.info('[REGISTRY] Using built-in registry implementation');
    return null;
  }

  logger.info(`[REGISTRY] Proxying to external registry: ${registryUrl}`);
  return createRegistryProxy(registryUrl);
}
