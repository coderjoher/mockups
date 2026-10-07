import { hashPassword } from './auth';
import { one } from './db';

export interface User {
  id: string;
  workspace_id: string;
  name: string;
  email: string;
  role: 'admin' | 'member';
  locale: 'en' | 'ar';
}

export async function createWorkspace(name: string): Promise<{ id: string }> {
  return (await one('INSERT INTO workspaces(name) VALUES ($1) RETURNING id', [name]))!;
}

export async function createUser(input: { workspaceId: string; name: string; email: string; password: string; role?: 'admin' | 'member'; locale?: 'en' | 'ar' }): Promise<User> {
  return (await one<User>(
    `INSERT INTO users(workspace_id, name, email, password_hash, role, locale) VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, workspace_id, name, email, role, locale`,
    [input.workspaceId, input.name, input.email.toLowerCase(), await hashPassword(input.password), input.role ?? 'member', input.locale ?? 'en'],
  ))!;
}

export async function findUserByEmail(email: string) {
  return one<User & { password_hash: string }>('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
}

export async function findUser(id: string) {
  return one<User>('SELECT id, workspace_id, name, email, role, locale FROM users WHERE id = $1', [id]);
}
