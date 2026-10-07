// SEED: imports the procedurally drawn placeholder photos (workers/render/mockup_render/seed.py) as published mockups.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { one } from './db';
import { createMockup, publishProblems, setScreens, setStatus, updateMockupMeta, type MockupRow } from './mockups';

export const SEED_LICENCE = {
  licence_source: 'BeCorp in-house (procedurally generated placeholder, replace with real photos)',
  licence_type: 'In-house (owned)',
  attribution_required: false,
};

const renderDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../workers/render');

export function generateSeedPhotos(outDir: string): void {
  execFileSync('python3', ['-m', 'mockup_render.seed', outDir], { cwd: renderDir, stdio: 'ignore' });
}

export async function importSeedMockups(dir: string, adminId: string): Promise<{ created: string[]; skipped: string[] }> {
  const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const created: string[] = [];
  const skipped: string[] = [];
  for (const m of manifest) {
    if (await one('SELECT 1 FROM mockups WHERE title = $1', [m.title])) {
      skipped.push(m.title);
      continue;
    }
    const row = await createMockup(adminId, readFileSync(m.file), `${m.slug}.jpg`);
    await updateMockupMeta(row.id, { title: m.title, tags: [m.device_type, m.scene, m.tone, 'placeholder'], device_type: m.device_type, scene: m.scene, tone: m.tone, ...SEED_LICENCE });
    await setScreens(row, m.screens);
    await setStatus(row.id, 'published');
    created.push(m.title);
  }
  return { created, skipped };
}

/** Every published mockup must have licence info and at least one valid screen. */
export async function auditPublished(): Promise<{ title: string; problems: string[] }[]> {
  const { query } = await import('./db');
  const rows = await query<MockupRow>("SELECT * FROM mockups WHERE status = 'published'");
  const out = [];
  for (const r of rows) out.push({ title: r.title, problems: await publishProblems(r) });
  return out;
}
