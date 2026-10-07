import { expect, test, type APIRequestContext } from '@playwright/test';
import { PNG } from 'pngjs';
import { login } from './helpers';

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
