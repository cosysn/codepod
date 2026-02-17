#!/usr/bin/env node
/**
 * CodePod CLI Entry Point
 */

import * as path from 'path';
import * as fs from 'fs';

// Load package.json for version (look in same directory)
const packageJsonPath = path.join(__dirname, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

export const VERSION = packageJson.version;
