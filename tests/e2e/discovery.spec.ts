import { expect, test } from '@playwright/test';
import { login } from './helpers';

async function createProject(page: import('@playwright/test').Page, site: string) {
  await login(page);
  await page.goto('/');
  await page.getByTestId('url-input').fill(`http://${site}.fixture.test:4100/`);
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page).toHaveURL(/\/projects\//);
}

test('[PD-5] checklist shows title, path and favicon with Home pre-selected', async ({ page }) => {
  await createProject(page, 'sitemap');
  await expect(page.getByTestId('discovery-status')).toHaveText('Found 6 pages');
  const rows = page.getByTestId('page-list').locator('li');
  await expect(rows).toHaveCount(6);
  await expect(rows.first()).toContainText('Sitemap Co — Home');
  await expect(rows.first().getByRole('checkbox')).toBeChecked();
  await expect(rows.nth(1).getByRole('checkbox')).not.toBeChecked();
  await expect(page.getByTestId('page-list').getByText('/about', { exact: true })).toBeVisible();
  await expect(rows.first().locator('img')).toHaveAttribute('src', 'http://sitemap.fixture.test:4100/favicon.png');
  await expect(page.getByTestId('selected-count')).toHaveText('1 / 20 selected');
});

test('[PD-7] search filters the list and pages can be added by hand', async ({ page }) => {
  await createProject(page, 'nositemap');
  await expect(page.getByTestId('discovery-status')).toHaveText('Found 7 pages');
  await page.getByTestId('page-search').fill('post');
  await expect(page.getByTestId('page-list').locator('li')).toHaveCount(1);
  await expect(page.getByTestId('page-list')).toContainText('First post');
  await page.getByTestId('page-search').fill('');
  await page.getByTestId('add-page').fill('/secret');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByTestId('page-list').locator('li')).toHaveCount(8);
  await expect(page.getByTestId('page-list')).toContainText('Secret');
  await page.getByTestId('add-page').fill('http://192.168.0.1/');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByTestId('pages-error')).toHaveText('Local and internal addresses are not allowed');
});

test('[PD-9] ticking a 21st page is refused with a message', async ({ page }) => {
  await createProject(page, 'huge');
  await expect(page.getByTestId('discovery-capped')).toContainText('200 page limit');
  const boxes = page.getByTestId('page-list').getByRole('checkbox');
  for (let i = 1; i < 20; i++) await boxes.nth(i).check();
  await expect(page.getByTestId('selected-count')).toHaveText('20 / 20 selected');
  await boxes.nth(20).click();
  await expect(page.getByTestId('pages-error')).toHaveText('You can select up to 20 pages per project');
  await expect(boxes.nth(20)).not.toBeChecked();
  await expect(page.getByTestId('selected-count')).toHaveText('20 / 20 selected');
});
