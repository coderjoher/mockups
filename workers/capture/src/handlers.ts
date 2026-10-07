import type { Handler } from '@mockups/core/queue';
import { captureJob } from './capture-job';
import { discoverProject } from './discover';

export const handlers: Record<string, Handler> = {
  discover: (data) => discoverProject(data),
  capture: (data, job) => captureJob(data, job),
};
