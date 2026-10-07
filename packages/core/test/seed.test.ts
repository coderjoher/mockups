import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { closePool, query } from '../src/db';
import { closeQueues } from '../src/queue';
import { auditPublished, generateSeedPhotos, importSeedMockups } from '../src/seed-mockups';
import { listMockups } from '../src/mockups';
import { makeUser, resetDb } from '../../../tests/setup/helpers';

afterAll(async () => {
  await closeQueues();
  await closePool();
});

describe('[SEED] in-house starter library', () => {
  it('publishes 10-15 mockups, each with licence info and valid screens, and re-running skips them', async () => {
    await resetDb();
    const admin = await makeUser('admin');
    const dir = mkdtempSync(path.join(os.tmpdir(), 'seed-test-'));
    generateSeedPhotos(dir);
    const first = await importSeedMockups(dir, admin.id);
    expect(first.created.length).toBeGreaterThanOrEqual(10);
    expect(first.created.length).toBeLessThanOrEqual(15);
    const published = await listMockups({});
    expect(published).toHaveLength(first.created.length);
    expect(published.every((m) => Math.max(m.width, m.height) >= 3000)).toBe(true);
    const audit = await auditPublished();
    expect(audit.filter((a) => a.problems.length)).toEqual([]);
    // Every device type and several scenes are covered.
    expect(new Set(published.map((m) => m.device_type))).toEqual(new Set(['desktop', 'laptop', 'tablet', 'mobile', 'multi']));
    const screens = await query('SELECT count(*)::int AS n FROM screens');
    expect(screens[0].n).toBeGreaterThan(first.created.length);
    const again = await importSeedMockups(dir, admin.id);
    expect(again).toEqual({ created: [], skipped: first.created });
  }, 180_000);
});
