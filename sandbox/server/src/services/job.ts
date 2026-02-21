/**
 * Job Service - SQLite-based job storage for runner job dispatch
 */

import { getDatabase } from '../db/database';
import { JobRepository } from '../db/repository';
import { store } from '../db/store';
import { logger } from '../logger';

let jobRepo: JobRepository | null = null;

function getJobRepo(): JobRepository {
  if (!jobRepo) {
    const db = getDatabase();
    jobRepo = new JobRepository(db);
  }
  return jobRepo;
}

export interface Job {
  id: string;
  type: 'create' | 'delete';
  sandboxId: string;
  image: string;
  token: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  runnerId?: string;
  createdAt: string;
  env?: Record<string, string>;
  memory?: string;
  cpu?: number;
  networkMode?: string;
}

/**
 * Create a new job
 */
export function createJob(data: Omit<Job, 'id' | 'status' | 'createdAt'>): Job {
  const repo = getJobRepo();
  const job = repo.create(data);
  return {
    id: job.id,
    type: job.type as 'create' | 'delete',
    sandboxId: job.sandboxId,
    image: job.image,
    token: job.token,
    status: job.status as 'pending' | 'running' | 'completed' | 'failed',
    runnerId: job.runnerId,
    createdAt: job.createdAt,
    env: job.env,
    memory: job.memory,
    cpu: job.cpu,
    networkMode: job.networkMode,
  };
}

/**
 * Get a job by ID
 */
export function getJob(id: string): Job | undefined {
  const repo = getJobRepo();
  const job = repo.getById(id);
  if (!job) return undefined;
  return {
    id: job.id,
    type: job.type as 'create' | 'delete',
    sandboxId: job.sandboxId,
    image: job.image,
    token: job.token,
    status: job.status as 'pending' | 'running' | 'completed' | 'failed',
    runnerId: job.runnerId,
    createdAt: job.createdAt,
    env: job.env,
    memory: job.memory,
    cpu: job.cpu,
    networkMode: job.networkMode,
  };
}

/**
 * Get pending jobs, optionally filtered by runnerId
 */
export function getPendingJobs(runnerId?: string): Job[] {
  const repo = getJobRepo();
  return repo.getPending(runnerId).map((job: any) => ({
    id: job.id,
    type: job.type as 'create' | 'delete',
    sandboxId: job.sandboxId,
    image: job.image,
    token: job.token,
    status: job.status as 'pending' | 'running' | 'completed' | 'failed',
    runnerId: job.runnerId,
    createdAt: job.createdAt,
    env: job.env,
    memory: job.memory,
    cpu: job.cpu,
    networkMode: job.networkMode,
  }));
}

/**
 * Assign a job to a runner
 */
export function assignJob(jobId: string, runnerId: string): boolean {
  const repo = getJobRepo();
  return repo.assign(jobId, runnerId);
}

import { SandboxRepository } from '../db/repository';

/**
 * Complete a job
 */
export function completeJob(jobId: string, success: boolean): boolean {
  const repo = getJobRepo();
  const job = repo.getById(jobId);

  logger.debug(`[completeJob] jobId=${jobId}, success=${success}, job.type=${job?.type}`);

  // If delete job completed successfully, also delete the sandbox from database
  if (job && job.type === 'delete' && success) {
    logger.debug(`[completeJob] Deleting sandbox ${job.sandboxId} from database`);
    const deleted = store.deleteSandbox(job.sandboxId);
    logger.debug(`[completeJob] Sandbox delete result: ${deleted}`);
  }

  return repo.complete(jobId, success);
}

/**
 * Get all jobs
 */
export function getAllJobs(): Job[] {
  const repo = getJobRepo();
  return repo.getAll().map((job: any) => ({
    id: job.id,
    type: job.type as 'create' | 'delete',
    sandboxId: job.sandboxId,
    image: job.image,
    token: job.token,
    status: job.status as 'pending' | 'running' | 'completed' | 'failed',
    runnerId: job.runnerId,
    createdAt: job.createdAt,
    env: job.env,
    memory: job.memory,
    cpu: job.cpu,
    networkMode: job.networkMode,
  }));
}
