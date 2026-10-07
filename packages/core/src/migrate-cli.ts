import { migrateDown, migrateUp } from './migrate';
import { closePool } from './db';

const cmd = process.argv[2] ?? 'up';
const ran = cmd === 'down' ? await migrateDown(Number(process.argv[3] ?? 1)) : await migrateUp();
console.log(`${cmd}: ${ran.length ? ran.join(', ') : 'nothing to do'}`);
await closePool();
