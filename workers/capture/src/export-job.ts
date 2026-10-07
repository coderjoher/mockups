import JSZip from 'jszip';
import { query } from '@mockups/core/db';
import { attributionText, renderNameParts } from '@mockups/core/exports';
import { exportName, siteName, uniqueNames } from '@mockups/core/filenames';
import { getStorage } from '@mockups/core/storage';

const WAIT_MS = () => Number(process.env.EXPORT_WAIT_MS ?? 10 * 60_000);

async function waitForRenders(ids: string[]) {
  const end = Date.now() + WAIT_MS();
  for (;;) {
    const rows = await query('SELECT id, status, outputs, error FROM renders WHERE id = ANY($1::uuid[])', [ids]);
    if (rows.length === ids.length && rows.every((r) => r.status === 'done' || r.status === 'failed')) return rows;
    if (Date.now() > end) throw new Error('Rendering took too long; try the export again');
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function zip(entries: { name: string; body: Buffer }[]): Promise<Buffer> {
  const z = new JSZip();
  // Fixed dates keep the archive reproducible.
  for (const e of entries) z.file(e.name, e.body, { date: new Date('2026-01-01T00:00:00Z') });
  return z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

/** EX-3 / EX-6: waits for the set's renders, then zips them with an attribution file when a licence needs one. */
export async function exportJob(data: { jobId: string; projectId: string; renderIds: string[]; formats: string[] }) {
  const renders = await waitForRenders(data.renderIds);
  const failed = renders.filter((r) => r.status === 'failed');
  if (failed.length === renders.length) throw new Error(`Rendering failed: ${failed[0].error ?? 'unknown error'}`);
  const storage = getStorage();
  const items: { name: string; key: string }[] = [];
  for (const r of renders.filter((x) => x.status === 'done')) {
    const parts = await renderNameParts(r.id);
    for (const fmt of data.formats) {
      if (r.outputs?.[fmt]) items.push({ name: exportName({ ...parts, ext: fmt }), key: r.outputs[fmt] });
    }
  }
  const names = uniqueNames(items.map((i) => i.name));
  const entries = await Promise.all(items.map(async (i, n) => ({ name: names[n], body: await storage.get(i.key) })));
  const credits = await attributionText(renders.map((r) => r.id));
  if (credits) entries.push({ name: 'ATTRIBUTION.txt', body: Buffer.from(credits, 'utf8') });
  const [project] = await query('SELECT root_url FROM projects WHERE id = $1', [data.projectId]);
  const zipKey = `exports/${data.projectId}/${siteName(project.root_url)}-mockups-${data.jobId.slice(0, 8)}.zip`;
  await storage.put(zipKey, await zip(entries), 'application/zip');
  return { zipKey, files: entries.map((e) => e.name), failed: failed.length };
}
