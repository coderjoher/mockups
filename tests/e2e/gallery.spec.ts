import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { login } from './helpers';

function png(w: number, h: number): Buffer {
  const p = new PNG({ width: w, height: h });
  for (let i = 0; i < p.data.length; i += 4) p.data.set([255, 140, 0, 255], i);
  return PNG.sync.write(p);
}

test('[CE-11] [CE-9-UI] [UP-1] gallery grid, retry, recapture and upload, in English and Arabic', async ({ page }) => {
  await login(page);
  await page.goto('/');
  await page.getByTestId('url-input').fill('http://botwall.fixture.test:4100/');
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByTestId('discovery-status')).toHaveText(/Found 1 pages/);
  await page.getByTestId('add-page').fill('/members');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByTestId('page-list').getByRole('checkbox', { name: 'Members' }).check();
  await page.getByTestId('to-capture').click();

  await page.getByTestId('start-capture').click();
  const rows = page.getByTestId('gallery-row');
  await expect(rows).toHaveCount(2);
  await expect(page.getByTestId('gallery').locator('th')).toHaveText(['', 'Desktop', 'Tablet', 'Mobile']);
  await expect(page.getByTestId('capture-progress')).toHaveText('3 of 6 captured', { timeout: 90_000 });
  await expect(rows.nth(1).locator('[data-status="failed"]')).toHaveCount(3, { timeout: 60_000 });

  // Home row: real thumbnails served through signed URLs.
  const thumb = rows.nth(0).getByTestId('cell-mobile').locator('img');
  await expect(thumb).toHaveAttribute('src', /\/api\/files\/captures\/.+\?exp=\d+&sig=/);
  expect(await thumb.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1170);

  // Failed row: the reason is shown with Retry and Upload.
  const failed = rows.nth(1).getByTestId('cell-desktop');
  await expect(failed.getByTestId('capture-reason')).toHaveText('The page returned HTTP 403');
  await failed.getByTestId('recapture').click();
  await expect(failed.locator('[data-status="failed"]')).toBeVisible({ timeout: 60_000 });

  const mobileFail = rows.nth(1).getByTestId('cell-mobile');
  await mobileFail.getByTestId('upload-input').setInputFiles({ name: 'mine.png', mimeType: 'image/png', buffer: png(390, 844) });
  await expect(mobileFail.locator('[data-status="done"] img')).toBeVisible();
  await expect(page.getByTestId('capture-progress')).toHaveText('4 of 6 captured');
  await mobileFail.getByTestId('upload-input').setInputFiles({ name: 'notes.txt', mimeType: 'image/png', buffer: Buffer.from('not an image') });
  await expect(mobileFail.getByTestId('cell-error')).toHaveText('Upload a PNG or JPG or WEBP image');

  // Recapture one good cell: only that cell runs again.
  const tablet = rows.nth(0).getByTestId('cell-tablet');
  await tablet.getByTestId('recapture').click();
  await expect(tablet.locator('[data-status="done"]')).toBeVisible({ timeout: 60_000 });
  await expect(rows.nth(0).getByTestId('cell-desktop').locator('[data-status="done"]')).toBeVisible();

  // Arabic / RTL.
  await page.getByTestId('lang-switch').click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.getByTestId('to-capture').click();
  await expect(page.getByTestId('gallery').locator('th')).toHaveText(['', 'حاسوب', 'جهاز لوحي', 'هاتف']);
  await expect(page.getByTestId('capture-progress')).toHaveText('تم التقاط 4 من 6');
});
