import { JobsOptions } from 'bullmq';
import { randomUUID } from 'crypto';

export function createMediumFrequencyJobOptions(jobId?: string): JobsOptions {
  return {
    jobId: jobId ?? randomUUID(),
    attempts: 3,
    backoff: { type: 'exponential', delay: 1500 },
    removeOnComplete: 75,
    removeOnFail: 35,
  };
}

export function createHighFrequencyJobOptions(jobId?: string): JobsOptions {
  return {
    jobId: jobId ?? randomUUID(),
    attempts: 2,
    backoff: { type: 'fixed', delay: 1000 },
    removeOnComplete: 50,
    removeOnFail: 25,
  };
}

export function createLowFrequencyJobOptions(jobId?: string): JobsOptions {
  return {
    jobId: jobId ?? randomUUID(),
    attempts: 1,
    removeOnComplete: 25,
    removeOnFail: 15,
  };
}
