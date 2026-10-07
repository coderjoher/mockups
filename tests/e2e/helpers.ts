import type { Page } from '@playwright/test';
import { ADMIN, MEMBER } from './global-setup';

export async function login(page: Page, who: 'admin' | 'member' = 'member') {
  const creds = who === 'admin' ? ADMIN : MEMBER;
  const res = await page.request.post('/api/auth/login', { data: creds });
  if (!res.ok()) throw new Error(`login failed: ${res.status()}`);
}

export const FIXTURES = 'http://127.0.0.1:4100';
