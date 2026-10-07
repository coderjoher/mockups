// Node worker process: page discovery, browser capture and ZIP export jobs.
import { startWorker } from '@mockups/core/queue';
import { handlers } from './handlers';

const concurrency: Record<string, number> = { discover: 4, capture: Number(process.env.CAPTURE_CONCURRENCY ?? 3), export: 2 };
const workers = Object.entries(handlers).map(([type, fn]) => startWorker(type as any, fn, { concurrency: concurrency[type] ?? 1 }));
console.log(`worker ready (${Object.keys(handlers).join(', ')})`);

async function shutdown() {
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
