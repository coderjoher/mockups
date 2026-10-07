import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { login, publishTestMockup } from './helpers';

test('[CR-2] [R-6] pick a mockup, see a preview, reassign a screen and render full size', async ({ page }) => {
  await login(page, 'admin');
  await publishTestMockup(page.request, 'E2E laptop and phone');

  await page.goto('/');
  await page.getByTestId('url-input').fill('http://sitemap.fixture.test:4100/');
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByTestId('discovery-status')).toHaveText('Found 6 pages');
  await page.getByTestId('page-list').getByRole('checkbox', { name: 'Contact' }).check();
  await page.getByTestId('to-capture').click();
  await page.getByTestId('start-capture').click();
  await expect(page.getByTestId('capture-progress')).toHaveText('6 of 6 captured', { timeout: 90_000 });
  await page.getByTestId('to-mockups').click();

  await page.getByTestId('mockup-card').filter({ hasText: 'E2E laptop and phone' }).click();
  const preview = page.getByTestId('render-preview');
  await expect(preview).toBeVisible({ timeout: 30_000 });
  expect(await preview.evaluate((i: HTMLImageElement) => [i.naturalWidth, i.naturalHeight])).toEqual([1600, 1000]);
  // Defaults: Home on the laptop (largest screen), the next page on the phone.
  await expect(page.getByTestId('assign-laptop').locator('option:checked')).toHaveText('Sitemap Co — Home · Desktop');
  await expect(page.getByTestId('assign-phone').locator('option:checked')).toHaveText('Contact · Mobile');

  const before = await preview.getAttribute('src');
  await page.getByTestId('assign-phone').selectOption({ label: 'Sitemap Co — Home · Mobile' });
  await expect(preview).not.toHaveAttribute('src', before!, { timeout: 30_000 });

  await page.getByTestId('render-final').click();
  const link = page.getByTestId('download-png');
  await expect(link).toBeVisible({ timeout: 60_000 });
  const png = PNG.sync.read(Buffer.from(await (await page.request.get(await link.getAttribute('href') as string)).body()));
  expect([png.width, png.height]).toEqual([3200, 2000]);
});
