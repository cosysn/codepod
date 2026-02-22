/**
 * CodePod TypeScript SDK
 * Inspired by E2B SDK design
 */

// Types
export * from './types';

// Client
export { CodePodClient, ErrorResponse } from './client';

// Sandbox
export { Sandbox, CommandResult, StreamOutput, CommandOptions, SandboxCreateOptions } from './sandbox';

// Version
export const VERSION = '0.2.0';
