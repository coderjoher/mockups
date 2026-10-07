import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';

test('[SC-3] [SC-2] sign up on the free plan, see usage and create an API key', async ({ page }) => {
  const email = `owner-${Date.now()}@agency.test`;
  await page.goto('/signup');
  await page.getByLabel('Your name').fill('Owner');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('long-password-1');
  await page.getByLabel('Agency or team name').fill('Agency');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL('http://127.0.0.1:3001/');
  await page.goto('/account');
  await expect(page.getByTestId('plan-name')).toHaveText('free');
  await expect(page.getByTestId('usage')).toHaveText('This month: 0 of 3 projects, 0 of 30 pages');
  await page.getByTestId('key-name').fill('Zapier');
  await page.getByTestId('key-create').click();
  const key = (await page.getByTestId('key-fresh').locator('code').textContent())!;
  expect(key).toMatch(/^mk_/);
  const res = await page.request.get('/api/v1/projects', { headers: { authorization: `Bearer ${key}` } });
  expect(res.status()).toBe(200);
  await page.reload();
  await expect(page.getByTestId('key-fresh')).toHaveCount(0);
  await expect(page.getByTestId('key-list')).toContainText('Zapier');
});

test('[EX-5] scrolling MP4 from a full-page capture', async ({ page }) => {
  const { login } = await import('./helpers');
  await login(page);
  const { project } = await (await page.request.post('/api/projects', { data: { url: 'http://capture.fixture.test:4100/' } })).json();
  await page.request.post(`/api/projects/${project.id}/captures`, { data: { mode: 'full', devices: ['desktop'] } });
  await page.goto(`/projects/${project.id}`);
  await page.getByTestId('to-capture').click();
  await page.getByTestId('capture-mode').selectOption('full');
  await expect(page.getByTestId('capture-progress')).toHaveText('1 of 1 captured', { timeout: 60_000 });
  await page.getByTestId('to-mockups').click();
  await page.getByTestId('layout-video').click();
  await expect(page.getByTestId('video-result')).toBeVisible({ timeout: 120_000 });
  // Open-source Chromium cannot decode H.264, so check the file itself with ffprobe.
  const href = (await page.getByTestId('download-mp4').getAttribute('href'))!;
  const body = Buffer.from(await (await page.request.get(href)).body());
  const file = path.join(os.tmpdir(), `scroll-${Date.now()}.mp4`);
  writeFileSync(file, body);
  const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString());
  expect(duration).toBeGreaterThanOrEqual(10);
  expect(duration).toBeLessThanOrEqual(20.1);
});
