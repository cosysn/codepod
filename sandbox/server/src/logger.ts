/**
 * Logger module - provides structured logging with file rotation
 */

import pino from 'pino';
import * as path from 'path';
import * as fs from 'fs';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pinoRoll = require('pino-roll');

// Ensure log directory exists
const logDir = '/var/log/codepod';
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const logFile = path.join(logDir, 'server.log');

// Create logger with file rotation
export const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
    transport: {
      target: 'pino-roll',
      options: {
        file: logFile,
        maxSize: process.env.LOG_MAX_SIZE || '100m',      // Rotate when file reaches 100MB
        maxFiles: parseInt(process.env.LOG_MAX_FILES || '7', 10),  // Keep 7 files
        frequency: process.env.LOG_FREQUENCY || 'daily',   // Also rotate daily
        zippedArchive: true,                               // Compress rotated logs
        mkdir: logDir,
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => {
        return { level: label };
      },
    },
  },
  pino.destination(logFile)
);

// Create child loggers for different modules
export const createLogger = (name: string) => {
  return logger.child({ module: name });
};

// Convenience methods
export const log = {
  info: (msg: string, ...args: any[]) => logger.info(msg, ...args),
  warn: (msg: string, ...args: any[]) => logger.warn(msg, ...args),
  error: (msg: string, ...args: any[]) => logger.error(msg, ...args),
  debug: (msg: string, ...args: any[]) => logger.debug(msg, ...args),
};

export default logger;
