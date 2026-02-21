/**
 * CodePod Server - Entry point
 */

import { createServer } from './server';
import { logger } from './logger';

const { start } = createServer();

logger.info('Starting CodePod Server...');
start().catch((err) => logger.error('Failed to start server: %s', err));
