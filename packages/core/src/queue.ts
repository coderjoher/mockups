import { Queue, Worker, type Job as BullJob } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from './config';
import { one, query } from './db';

export type JobType = 'discover' | 'capture' | 'render' | 'export';
export const JOB_TYPES: JobType[] = ['discover', 'capture', 'render', 'export'];

// F-5: one try plus two retries, exponential backoff.
export const JOB_ATTEMPTS = 3;
export const backoffMs = () => Number(process.env.JOB_BACKOFF_MS ?? 2000);

let connection: Redis | undefined;
const queues = new Map<JobType, Queue>();

export function redis(): Redis {
  if (!connection) connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  return connection;
}

export function getQueue(type: JobType): Queue {
  let q = queues.get(type);
  if (!q) {
    q = new Queue(type, { connection: redis(), prefix: config.queuePrefix });
    queues.set(type, q);
  }
  return q;
}

export interface JobRow {
  id: string;
  type: JobType;
  project_id: string | null;
  payload: any;
  attempts: number;
  status: 'queued' | 'running' | 'done' | 'failed';
  error: string | null;
  result: any;
  queued_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

export async function enqueue(
  type: JobType,
  payload: Record<string, unknown>,
  projectId: string | null = null,
  opts: { attempts?: number; beforePush?: (jobId: string) => Promise<void> } = {},
): Promise<string> {
  const row = await one<JobRow>(
    'INSERT INTO jobs(type, project_id, payload) VALUES ($1, $2, $3) RETURNING id',
    [type, projectId, JSON.stringify(payload)],
  );
  const jobId = row!.id;
  // Link any rows to the job before a worker can pick it up.
  if (opts.beforePush) await opts.beforePush(jobId);
  await getQueue(type).add(type, { jobId, ...payload }, {
    jobId,
    attempts: opts.attempts ?? JOB_ATTEMPTS,
    backoff: { type: 'exponential', delay: backoffMs() },
    removeOnComplete: 1000,
    removeOnFail: 1000,
  });
  return jobId;
}

export async function getJob(id: string): Promise<JobRow | undefined> {
  return one<JobRow>('SELECT * FROM jobs WHERE id = $1', [id]);
}

export type Handler = (data: any, job: BullJob) => Promise<unknown>;

/** Runs a handler for one job type and mirrors every state change into Postgres. */
export function startWorker(type: JobType, handler: Handler, opts: { concurrency?: number } = {}): Worker {
  const worker = new Worker(
    type,
    async (job) => {
      const { jobId } = job.data;
      await query("UPDATE jobs SET status = 'running', attempts = $2, started_at = now(), error = NULL WHERE id = $1", [jobId, job.attemptsMade + 1]);
      const result = await handler(job.data, job);
      await query("UPDATE jobs SET status = 'done', result = $2, finished_at = now() WHERE id = $1", [jobId, JSON.stringify(result ?? null)]);
      return result ?? null;
    },
    { connection: redis().duplicate(), prefix: config.queuePrefix, concurrency: opts.concurrency ?? 1 },
  );
  worker.on('failed', async (job, err) => {
    if (!job) return;
    const final = job.attemptsMade >= (job.opts.attempts ?? 1);
    await query('UPDATE jobs SET status = $2, error = $3, finished_at = CASE WHEN $2 = \'failed\' THEN now() ELSE NULL END WHERE id = $1', [
      job.data.jobId,
      final ? 'failed' : 'queued',
      String(err?.message ?? err),
    ]).catch(() => {});
  });
  return worker;
}

export async function closeQueues(): Promise<void> {
  for (const q of queues.values()) await q.close();
  queues.clear();
  if (connection) await connection.quit();
  connection = undefined;
}
