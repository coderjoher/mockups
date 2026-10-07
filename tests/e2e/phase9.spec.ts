import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { expect, test } from '@playwright/test';
import { login, publishTestMockup } from './helpers';

test('[ML-3] [EX-4] [EX-2] favourites, recently used, presets in the ZIP and a revocable share link', async ({ page, browser }) => {
  await login(page, 'admin');
  await publishTestMockup(page.request, 'Favourite duo');
  await page.goto('/');
  await page.getByTestId('url-input').fill('http://brand.fixture.test:4100/');
  await page.getByTestId('url-input').press('Enter');
  await expect(page.getByTestId('discovery-status')).not.toHaveText(/…/);
  await page.getByTestId('to-capture').click();
  await page.getByTestId('start-capture').click();
  await expect(page.getByTestId('capture-progress')).toHaveText('3 of 3 captured', { timeout: 60_000 });
  await page.getByTestId('to-mockups').click();

  // CX-3: the site's colours are offered as backgrounds.
  await expect(page.getByTestId('brand-swatch').first()).toBeVisible();

  // ML-3: favourite a mockup and filter to favourites.
  const card = page.getByTestId('mockup-card').filter({ hasText: 'Favourite duo' });
  await card.getByTestId('favourite').click();
  await expect(card.getByTestId('favourite')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('only-favourites').check();
  await expect(page.getByTestId('mockup-card')).toHaveCount(1);
  await page.getByTestId('only-favourites').uncheck();

  await card.click();
  await expect(page.getByTestId('render-preview')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('render-final').click();
  await expect(page.getByTestId('download-png')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('preset-ig_story').check();
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 90_000 }), page.getByTestId('download-zip').click()]);
  const zip = await JSZip.loadAsync(readFileSync((await download.path())!));
  expect(Object.keys(zip.files).sort()).toEqual(['brand-fixture-test_brand-co_multi_favourite-duo-ig-story.png', 'brand-fixture-test_brand-co_multi_favourite-duo.png']);

  // Recently used now lists the mockup.
  await page.reload();
  await page.getByTestId('to-capture').click();
  await page.getByTestId('to-mockups').click();
  await expect(page.getByTestId('recent-row')).toContainText('Favourite duo');

  // EX-4: share link works logged out and stops working once turned off.
  await page.getByTestId('share-panel').locator('summary').click();
  await page.getByTestId('share-create').click();
  const shareUrl = await page.getByTestId('share-url').inputValue();
  const anon = await browser.newPage();
  await anon.goto(shareUrl);
  await expect(anon.getByTestId('share-title')).toHaveText('Brand Co');
  await expect(anon.getByTestId('share-renders').locator('li')).toHaveCount(1);
  await page.getByTestId('share-revoke').click();
  await expect(page.getByTestId('share-url')).toHaveCount(0);
  await anon.reload();
  await expect(anon.getByTestId('share-error')).toHaveText('This link has expired or was turned off');
  await anon.close();
});
