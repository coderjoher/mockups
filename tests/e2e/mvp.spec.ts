import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { expect, test, type Page } from '@playwright/test';
import { login, publishTestMockup } from './helpers';

async function fullFlow(page: Page, site: string, pages: string[], lang: 'en' | 'ar' = 'en') {
  const started = Date.now();
  await page.goto('/');
  await page.getByTestId('url-input').fill(`http://${site}.fixture.test:4100/`);
  await page.getByTestId('url-input').press('Enter');
  await expect(page.getByTestId('page-list').locator('li').first()).toBeVisible();
  await expect(page.getByTestId('discovery-status')).not.toHaveText(/…/);
  for (const name of pages) await page.getByTestId('page-list').getByRole('checkbox', { name }).check();
  await page.getByTestId('to-capture').click();
  await page.getByTestId('start-capture').click();
  const total = (pages.length + 1) * 3;
  const progress = lang === 'en' ? `${total} of ${total} captured` : `تم التقاط ${total} من ${total}`;
  await expect(page.getByTestId('capture-progress')).toHaveText(progress, { timeout: 100_000 });
  await page.getByTestId('to-mockups').click();
  await page.getByTestId('mockup-card').filter({ hasText: 'MVP duo' }).click();
  await expect(page.getByTestId('render-preview')).toBeVisible({ timeout: 30_000 });
  return started;
}

async function downloadZip(page: Page) {
  await page.getByTestId('render-final').click();
  await expect(page.getByTestId('download-png')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('format-webp').check();
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 90_000 }), page.getByTestId('download-zip').click()]);
  const path = await download.path();
  return { zip: await JSZip.loadAsync(readFileSync(path!)), name: download.suggestedFilename() };
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await login(page, 'admin');
  await publishTestMockup(page.request, 'MVP duo');
  await page.close();
});

test('[MVP] URL to ZIP of a three-page set in under 2 minutes', async ({ page }) => {
  await login(page);
  const started = await fullFlow(page, 'sitemap', ['About us', 'Contact']);
  // [CX-1] swap the page on the phone screen; the preview updates and the export follows it.
  const before = await page.getByTestId('render-preview').getAttribute('src');
  await page.getByTestId('assign-phone').selectOption({ label: 'Contact · Mobile' });
  await expect(page.getByTestId('render-preview')).not.toHaveAttribute('src', before!, { timeout: 30_000 });
  const { zip, name } = await downloadZip(page);
  expect(Date.now() - started).toBeLessThan(120_000);
  expect(name).toMatch(/^sitemap-fixture-test-mockups-.+\.zip$/);
  expect(Object.keys(zip.files).sort()).toEqual(['sitemap-fixture-test_sitemap-co-home_multi_mvp-duo.png', 'sitemap-fixture-test_sitemap-co-home_multi_mvp-duo.webp']);
});

test('[CX-1] swapping the page changes what is exported', async ({ page }) => {
  await login(page);
  await fullFlow(page, 'sitemap', ['Pricing']);
  await page.getByTestId('assign-laptop').selectOption({ label: 'Pricing · Desktop' });
  await expect(page.getByTestId('assign-laptop').locator('option:checked')).toHaveText('Pricing · Desktop');
  await expect(page.getByTestId('render-pending')).toHaveCount(0, { timeout: 30_000 });
  const { zip } = await downloadZip(page);
  expect(Object.keys(zip.files).some((f) => f.includes('_pricing_multi_'))).toBe(true);
});

test('[MVP] Arabic RTL site, Arabic interface', async ({ page }) => {
  await login(page);
  await page.context().addCookies([{ name: 'locale', value: 'ar', url: 'http://127.0.0.1:3001' }]);
  await fullFlow(page, 'arabic', ['من نحن'], 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  const { zip } = await downloadZip(page);
  expect(Object.keys(zip.files).some((f) => f.includes('arabic-fixture-test_شركة-النماذج-التصميم'))).toBe(true);
});
