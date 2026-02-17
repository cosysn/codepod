#!/usr/bin/env node
/**
 * CodePod CLI Entry Point
 */

import * as path from 'path';
import * as fs from 'fs';

// Load package.json for version
const packageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
);

export const VERSION = packageJson.version;
