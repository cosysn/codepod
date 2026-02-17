/**
 * CodePod Server - Entry point
 */

import { createServer } from './server';

const { start } = createServer();

console.log('Starting CodePod Server...');
start();
