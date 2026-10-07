import { expect, test } from '@playwright/test';
import { FIXTURES, login } from './helpers';

test('[PD-1] a dead URL shows a clear message; a working one opens the project', async ({ page }) => {
  await login(page);
  await page.goto('/');
  await page.getByTestId('url-input').fill('http://broken.fixture.test:4100/');
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByTestId('url-error')).toHaveText('The site did not load (HTTP 500)');

  await page.getByTestId('url-input').fill('http://169.254.169.254/');
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByTestId('url-error')).toHaveText('Local and internal addresses are not allowed');

  await page.getByTestId('url-input').fill(`${FIXTURES.replace('127.0.0.1', 'arabic.fixture.test')}/?utm_campaign=x`);
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('شركة النماذج & التصميم');
});
