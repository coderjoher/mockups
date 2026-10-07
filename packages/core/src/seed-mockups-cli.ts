import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closePool, one } from './db';
import { closeQueues } from './queue';
import { generateSeedPhotos, importSeedMockups } from './seed-mockups';

const admin = await one("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1");
if (!admin) throw new Error('Run `npm run seed` first to create an admin');
const dir = process.argv[2] ?? mkdtempSync(path.join(os.tmpdir(), 'seed-mockups-'));
if (!process.argv[2]) generateSeedPhotos(dir);
const res = await importSeedMockups(dir, admin.id);
console.log(`created ${res.created.length}, skipped ${res.skipped.length}`);
await closeQueues();
await closePool();
