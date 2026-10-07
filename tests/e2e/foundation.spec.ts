import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('[F-7] switching to Arabic flips the whole layout to RTL', async ({ page }) => {
  await login(page);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByTestId('lang-switch').click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.getByRole('link', { name: 'المشاريع' })).toBeVisible();
  // Logical spacing puts the language button on the left edge in RTL.
  const box = await page.getByTestId('lang-switch').boundingBox();
  expect(box!.x).toBeLessThan(page.viewportSize()!.width / 2);
  await page.getByTestId('lang-switch').click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});

test('sign-in page rejects a wrong password', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('member@e2e.test');
  await page.getByLabel('Password').fill('wrong');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('main').getByRole('alert')).toHaveText('Wrong email or password');
});
