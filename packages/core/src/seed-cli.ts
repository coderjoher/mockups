// Creates the first workspace and admin account if none exists.
import { closePool, one } from './db';
import { createUser, createWorkspace } from './users';

const email = process.env.ADMIN_EMAIL ?? 'admin@example.com';
const password = process.env.ADMIN_PASSWORD ?? 'admin12345';
if (!(await one('SELECT 1 FROM users WHERE email = $1', [email]))) {
  const ws = await createWorkspace(process.env.WORKSPACE_NAME ?? 'BeCorp');
  await createUser({ workspaceId: ws.id, name: 'Admin', email, password, role: 'admin' });
  console.log(`created admin ${email}`);
} else {
  console.log('admin already exists');
}
await closePool();
