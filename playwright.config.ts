import { defineConfig, devices } from '@playwright/test';

// The whole stack runs against its own database, Redis prefix and storage dir.
const env = {
  DATABASE_URL: 'postgres://postgres@127.0.0.1:5432/mockups_e2e',
  QUEUE_PREFIX: 'mockups-e2e',
  STORAGE_DIR: `${process.cwd()}/.data/e2e-storage`,
  PUBLIC_API_URL: 'http://127.0.0.1:3001/api',
  API_URL: 'http://127.0.0.1:4001',
  APP_SECRET: 'e2e-secret',
  PORT: '4001',
  HOST: '127.0.0.1',
  JOB_BACKOFF_MS: '200',
  E2E: '1',
  FIXTURE_HOSTS: 'fixture.test=127.0.0.1',
};
Object.assign(process.env, env);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  globalSetup: './tests/e2e/global-setup.ts',
  use: { baseURL: 'http://127.0.0.1:3001', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, grep: /@cross-browser/ },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, grep: /@cross-browser/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],
  webServer: [
    { command: 'npx tsx tests/fixtures/server.ts', port: 4100, env, reuseExistingServer: !process.env.CI },
    { command: 'npx tsx apps/api/src/server.ts', url: 'http://127.0.0.1:4001/health', env, reuseExistingServer: !process.env.CI },
    { command: 'npx tsx workers/capture/src/main.ts', env, reuseExistingServer: false, wait: { stdout: /worker ready/ } },
    { command: 'cd workers/render && python3 -m mockup_render.worker', env, reuseExistingServer: false, wait: { stdout: /render worker ready/ } },
    {
      command: 'npm --workspace apps/web run build && npx --workspace apps/web next start -p 3001',
      url: 'http://127.0.0.1:3001/login',
      env,
      timeout: 300_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
