import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/*.test.ts', 'packages/*/test/**/*.test.ts', 'apps/api/test/**/*.test.ts', 'workers/capture/test/**/*.test.ts', 'apps/web/test/**/*.test.ts'],
    globalSetup: ['tests/setup/global.ts'],
    setupFiles: ['tests/setup/env.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**', 'apps/api/src/**', 'workers/capture/src/**', 'apps/web/lib/i18n.ts'],
      exclude: ['**/*-cli.ts', '**/server.ts', '**/main.ts'],
      thresholds: { lines: 80 },
    },
  },
});
