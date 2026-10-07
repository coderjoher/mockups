import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { ADMIN, MEMBER } from './global-setup';

export async function login(page: Page, who: 'admin' | 'member' = 'member') {
  const creds = who === 'admin' ? ADMIN : MEMBER;
  const res = await page.request.post('/api/auth/login', { data: creds });
  if (!res.ok()) throw new Error(`login failed: ${res.status()}`);
}

export const FIXTURES = 'http://127.0.0.1:4100';

function photo(w: number, h: number): Buffer {
  const p = new PNG({ width: w, height: h });
  for (let i = 0; i < p.data.length; i += 4) p.data.set([214, 208, 200, 255], i);
  return PNG.sync.write(p);
}

/** Creates and publishes a two-screen mockup through the admin API. */
export async function publishTestMockup(request: APIRequestContext, title: string) {
  const up = await request.post('/api/admin/mockups', { multipart: { file: { name: `${title}.png`, mimeType: 'image/png', buffer: photo(3200, 2000) } } });
  expect(up.ok()).toBe(true);
  const { mockup } = await up.json();
  const screens = [
    { screenId: 'laptop', device: 'desktop', corners: { tl: [300, 300], tr: [2100, 360], br: [2060, 1500], bl: [330, 1480] }, cornerRadius: 8, zIndex: 1 },
    { screenId: 'phone', device: 'mobile', corners: { tl: [2300, 600], tr: [2800, 640], br: [2760, 1700], bl: [2260, 1660] }, cornerRadius: 40, zIndex: 2 },
  ];
  expect((await request.put(`/api/admin/mockups/${mockup.id}/screens`, { data: { screens } })).ok()).toBe(true);
  expect((await request.patch(`/api/admin/mockups/${mockup.id}`, { data: { title, device_type: 'multi', scene: 'desk', tone: 'light', licence_source: 'in-house', licence_type: 'In-house (owned)' } })).ok()).toBe(true);
  expect((await request.post(`/api/admin/mockups/${mockup.id}/publish`)).ok()).toBe(true);
  return mockup.id as string;
}

