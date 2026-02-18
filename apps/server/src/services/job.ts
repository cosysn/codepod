/**
 * Job Service - In-memory job storage for runner job dispatch
 */

export interface Job {
  id: string;
  type: 'create' | 'delete';
  sandboxId: string;
  image: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  runnerId?: string;
  createdAt: string;
}

// In-memory job storage
const jobs = new Map<string, Job>();

/**
 * Create a new job
 */
export function createJob(data: Omit<Job, 'id' | 'status' | 'createdAt'>): Job {
  const job: Job = {
    id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    ...data,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);
  return job;
}

/**
 * Get a job by ID
 */
export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

/**
 * Get pending jobs, optionally filtered by runnerId
 * Returns jobs that are pending and not yet assigned to any runner
 * or not assigned to the specified runner
 */
export function getPendingJobs(runnerId?: string): Job[] {
  return Array.from(jobs.values()).filter((job) =>
    job.status === 'pending' && (!runnerId || !job.runnerId)
  );
}

/**
 * Assign a job to a runner
 */
export function assignJob(jobId: string, runnerId: string): boolean {
  const job = jobs.get(jobId);
  if (!job || job.status !== 'pending') return false;
  job.runnerId = runnerId;
  job.status = 'running';
  return true;
}

/**
 * Complete a job
 */
export function completeJob(jobId: string, success: boolean): boolean {
  const job = jobs.get(jobId);
  if (!job) return false;
  job.status = success ? 'completed' : 'failed';
  return true;
}

/**
 * Get all jobs
 */
export function getAllJobs(): Job[] {
  return Array.from(jobs.values());
}
