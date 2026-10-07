import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { login } from './helpers';

function photo(w: number, h: number): Buffer {
  const p = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const inScreen = x > 800 && x < 2400 && y > 400 && y < 1400;
      p.data[i] = inScreen ? 10 : 200;
      p.data[i + 1] = inScreen ? 10 : 190 - Math.floor(y / 40);
      p.data[i + 2] = inScreen ? 12 : 180;
      p.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(p);
}

test('[CP-2] [CP-3] admin marks a screen by clicking corners, drags and nudges a handle, and it persists', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/admin/mockups');
  await page.getByTestId('mockup-upload').setInputFiles({ name: 'studio-laptop.png', mimeType: 'image/png', buffer: photo(3200, 2000) });
  await expect(page).toHaveURL(/\/admin\/mockups\/[0-9a-f-]{36}$/);
  const id = page.url().split('/').pop()!;

  await page.getByTestId('add-screen').click();
  await expect(page.getByTestId('picker-hint')).toHaveText('Click the top-left corner of screen s1');
  const img = page.getByTestId('picker-image');
  await expect(img).toBeVisible();
  const box = (await img.boundingBox())!;
  const scale = box.width / 3200;
  const at = (x: number, y: number) => ({ x: x * scale, y: y * scale });
  await img.click({ position: at(800, 400) });
  await expect(page.getByTestId('picker-hint')).toHaveText('Click the top-right corner of screen s1');
  await img.click({ position: at(2400, 400) });
  await img.click({ position: at(2400, 1400) });
  await img.click({ position: at(800, 1400) });
  await expect(page.getByTestId('picker-hint')).toHaveCount(0);
  // Live warped test image appears over the screen.
  // (the browser reports a plain matrix when the quad is still a rectangle)
  await expect(page.getByTestId('warp-s1')).toHaveCSS('transform', /^matrix/);

  // Drag the bottom-right handle 30 display px right; the loupe draws while dragging.
  const handle = page.getByTestId('handle-s1-br');
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 30, hb.y + hb.height / 2, { steps: 5 });
  const loupePixels = await page.getByTestId('loupe').evaluate((c: HTMLCanvasElement) => c.getContext('2d')!.getImageData(0, 0, 160, 160).data.some((v) => v > 0));
  expect(loupePixels).toBe(true);
  await page.mouse.up();
  // Now a true perspective quad: the live preview uses a 3D matrix.
  await expect(page.getByTestId('warp-s1')).toHaveCSS('transform', /matrix3d/);
  const dragged = (await page.getByTestId('handle-coords').textContent())!;
  const [bx] = dragged.split(': ')[1].split(', ').map(Number);
  expect(Math.abs(bx - (2400 + 30 / scale))).toBeLessThan(2 / scale);

  // Arrow keys nudge by exactly one photo pixel.
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowUp');
  const nudged = (await page.getByTestId('handle-coords').textContent())!.split(': ')[1].split(', ').map(Number);
  expect(nudged[0]).toBeCloseTo(bx - 1, 5);

  await page.getByTestId('device-s1').selectOption('desktop');
  await page.getByTestId('radius-s1').fill('12');
  await page.getByTestId('save-screens').click();
  await expect(page.getByTestId('save-screens')).toHaveText('Saved');

  // Reload: the saved corners are exactly what was placed.
  const res = await page.request.get(`/api/mockups/${id}`);
  const s = (await res.json()).mockup.screens[0];
  expect(s).toMatchObject({ screen_key: 's1', device: 'desktop', corner_radius: 12 });
  expect(s.corners.br).toEqual(nudged);
  expect(Math.abs(s.corners.tl[0] - 800)).toBeLessThan(2 / scale);
  expect(Math.abs(s.corners.tl[1] - 400)).toBeLessThan(2 / scale);
  await page.reload();
  await expect(page.getByTestId('handle-s1-tl')).toBeVisible();
  await expect(page.getByTestId('warp-s1')).toBeVisible();

  // Publishing without licence info is refused (CP-7) with a clear message.
  await page.getByTestId('publish').click();
  await expect(page.getByTestId('editor-error')).toHaveText('Licence source is required. Licence type is required');
});
