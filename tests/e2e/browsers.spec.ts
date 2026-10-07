import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('[NF-BROWSER] sign in, start a project and see the checklist @cross-browser', async ({ page }) => {
  await login(page);
  await page.goto('/');
  await page.getByTestId('url-input').fill('http://sitemap.fixture.test:4100/');
  await page.getByTestId('url-input').press('Enter');
  await expect(page.getByTestId('discovery-status')).toHaveText('Found 6 pages', { timeout: 30_000 });
  await page.getByTestId('page-list').getByRole('checkbox', { name: 'Pricing' }).check();
  await expect(page.getByTestId('selected-count')).toHaveText('2 / 20 selected');
  await page.getByTestId('lang-switch').click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
});

test('[NF-BROWSER] view and download on a phone @mobile', async ({ page }) => {
  await login(page);
  const res = await page.request.post('/api/projects', { data: { url: 'http://capture.fixture.test:4100/' } });
  const { project } = await res.json();
  await page.request.post(`/api/projects/${project.id}/captures`, { data: { devices: ['mobile'] } });
  await page.goto(`/projects/${project.id}`);
  await page.getByTestId('to-capture').click();
  const img = page.getByTestId('gallery-row').first().getByTestId('cell-mobile').locator('img');
  await expect(img).toBeVisible({ timeout: 60_000 });
  const href = await img.getAttribute('src');
  const file = await page.request.get(href!);
  expect(file.headers()['content-type']).toBe('image/png');
  expect(page.viewportSize()!.width).toBeLessThan(500);
});
