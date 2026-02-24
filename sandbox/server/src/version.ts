/**
 * CodePod Server Version
 */

// Try to get version from environment variable first, then fall back to package.json
export const VERSION = process.env.CODPOD_VERSION || '0.0.0';
