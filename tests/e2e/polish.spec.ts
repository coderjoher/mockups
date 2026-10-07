import { expect, test } from '@playwright/test';
import { login, publishTestMockup } from './helpers';

test('[PD-6] [PD-8] grouped templates and a language filter in the checklist', async ({ page }) => {
  await login(page);
  await page.goto('/');
  await page.getByTestId('url-input').fill('http://shop.fixture.test:4100/');
  await page.getByTestId('url-input').press('Enter');
  await expect(page.getByTestId('discovery-status')).toHaveText('Found 19 pages');
  const list = page.getByTestId('page-list');
  // 12 products and 3 posts collapse to one sample each.
  await expect(list.locator('li')).toHaveCount(19 - 11 - 2);
  const toggle = page.getByTestId('group-toggle').filter({ hasText: '/product/*' });
  await expect(toggle).toHaveText('+11 more like /product/*');
  await toggle.click();
  await expect(list.locator('li')).toHaveCount(19 - 2);
  await page.getByTestId('lang-filter').selectOption('ar');
  await expect(list.locator('li')).toHaveCount(1);
  await expect(list).toContainText('المتجر');
});

test('[ML-2] [CR-4] [CR-5] live library previews, batch mode and a grid layout', async ({ page }) => {
  await login(page, 'admin');
  await publishTestMockup(page.request, 'Polish duo');
  await page.goto('/');
  await page.getByTestId('url-input').fill('http://sitemap.fixture.test:4100/');
  await page.getByTestId('url-input').press('Enter');
  await expect(page.getByTestId('discovery-status')).toHaveText('Found 6 pages');
  await page.getByTestId('page-list').getByRole('checkbox', { name: 'Services' }).check();
  await page.getByTestId('to-capture').click();
  await page.getByTestId('start-capture').click();
  await expect(page.getByTestId('capture-progress')).toHaveText('6 of 6 captured', { timeout: 90_000 });
  await page.getByTestId('to-mockups').click();

  // ML-2: the card shows this site's own Home capture on the mockup's screens.
  const card = page.getByTestId('mockup-card').filter({ hasText: 'Polish duo' });
  await expect(card.getByTestId('live-screen')).toHaveCount(2);
  await expect(card.getByTestId('live-screen').first()).toHaveAttribute('src', /\/api\/files\/captures\//);

  // CR-5 grid of all pages.
  await page.getByTestId('layout-grid').click();
  await expect(page.getByTestId('layout-result')).toBeVisible({ timeout: 60_000 });

  // CR-4 batch: one mockup per captured page.
  await card.click();
  await expect(page.getByTestId('render-preview')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('batch').click();
  await expect(page.getByTestId('batch-note')).toHaveText('2 mockups added to the set', { timeout: 90_000 });
  await expect(page.getByTestId('export-panel')).toContainText('Download the set (3 mockups)');
});
