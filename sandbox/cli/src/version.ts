#!/usr/bin/env node
/**
 * CodePod CLI Version
 */

import * as path from 'path';
import * as fs from 'fs';

// Try to get version from environment variable first, then fall back to package.json
export const VERSION = process.env.CODPOD_VERSION || (() => {
  const packageJsonPath = path.join(__dirname, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  return packageJson.version;
})();
