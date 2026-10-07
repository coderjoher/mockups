import type { Handler } from '@mockups/core/queue';
import { discoverProject } from './discover';

export const handlers: Record<string, Handler> = {
  discover: (data) => discoverProject(data),
};
