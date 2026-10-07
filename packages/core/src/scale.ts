// SC-4: queue-length based scaling signal for capture and render workers.
import { getQueue, type JobType } from './queue';

export interface QueueStats {
  waiting: number;
  active: number;
  delayed: number;
}

export async function queueStats(type: JobType): Promise<QueueStats> {
  const counts = await getQueue(type).getJobCounts('waiting', 'active', 'delayed', 'prioritized');
  return { waiting: (counts.waiting ?? 0) + (counts.prioritized ?? 0), active: counts.active ?? 0, delayed: counts.delayed ?? 0 };
}

/** Workers needed so that the backlog clears: one worker per `perWorker` jobs in flight, within [min, max]. */
export function desiredWorkers(stats: QueueStats, perWorker: number, min = 1, max = 10): number {
  const load = stats.waiting + stats.active;
  return Math.max(min, Math.min(max, Math.ceil(load / Math.max(1, perWorker))));
}

export async function scalingAdvice() {
  const capture = await queueStats('capture');
  const render = await queueStats('render');
  return {
    capture: { ...capture, desired: desiredWorkers(capture, Number(process.env.CAPTURE_CONCURRENCY ?? 3)) },
    render: { ...render, desired: desiredWorkers(render, 2) },
  };
}
