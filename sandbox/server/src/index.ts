/**
 * CodePod Server - Entry point
 */

import { createServer } from './server';
import { logger } from './logger';
import { initDatabase } from './db/database';
import * as path from 'path';

// Initialize database with file storage
const dbPath = process.env.CODEPOD_DB_PATH || path.join(process.cwd(), 'data', 'codepod.db');
initDatabase(dbPath);
logger.info('Database initialized at: %s', dbPath);

const { start } = createServer();

logger.info('Starting CodePod Server...');
start().catch((err) => logger.error('Failed to start server: %s', err));
