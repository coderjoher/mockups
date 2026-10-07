import JSZip from 'jszip';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Worker } from 'bullmq';
import { buildApp } from '../../../apps/api/src/app';
import { closePool, query } from '@mockups/core/db';
import { closeQueues, startWorker } from '@mockups/core/queue';
import { exportName, slug, uniqueNames } from '@mockups/core/filenames';
import { deleteExpiredCaptures } from '@mockups/core/retention';
import { getStorage } from '@mockups/core/storage';
import { exportJob } from '../src/export-job';
import { auth, makeUser, resetDb, resetRedis, waitFor } from '../../../tests/setup/helpers';

let app: FastifyInstance;
let renderWorker: Worker;
beforeAll(async () => {
  app = await buildApp();
  // Stand-in for the Python render worker: writes a small image for each requested format.
  renderWorker = startWorker('render', async (data) => {
    const [r] = await query('SELECT * FROM renders WHERE id = $1', [data.renderId]);
    const png = new PNG({ width: 8, height: 5 });
    const outputs: Record<string, string> = {};
    for (const f of r.options.formats ?? ['png']) {
      outputs[f] = `renders/${r.project_id}/${r.id}/native.${f}`;
      await getStorage().put(outputs[f], PNG.sync.write(png));
    }
    await query("UPDATE renders SET status = 'done', outputs = $2 WHERE id = $1", [r.id, JSON.stringify(outputs)]);
  });
});
beforeEach(async () => {
  await resetDb();
  await resetRedis();
});
afterAll(async () => {
  await renderWorker.close();
  await app.close();
  await closeQueues();
  await closePool();
});

describe('[EX-3] file names', () => {
  it('builds site_page_device_mockup.ext and keeps Arabic letters', () => {
    expect(exportName({ site: 'www.example.com', page: 'About Us!', device: 'mobile', mockup: 'Phone, front', ext: 'png' })).toBe('www-example-com_about-us_mobile_phone-front.png');
    expect(slug('مَن نحن؟ — الشركة')).toBe('من-نحن-الشركة');
    expect(slug('///')).toBe('page');
    expect(uniqueNames(['a.png', 'a.png', 'b.png', 'a.png'])).toEqual(['a.png', 'a-2.png', 'b.png', 'a-3.png']);
  });
});

async function setup(attribution: boolean) {
  const u = await makeUser();
  const [project] = await query("INSERT INTO projects(workspace_id, owner_id, root_url) VALUES ($1,$2,'https://www.acme.iq/') RETURNING *", [u.workspace_id, u.id]);
  const pages = [];
  for (const [i, title] of ['الرئيسية', 'Contact'].entries()) {
    const [pg] = await query('INSERT INTO pages(project_id, url, title, "order", selected) VALUES ($1,$2,$3,$4,true) RETURNING *', [project.id, `https://www.acme.iq/${i}`, title, i]);
    const [c] = await query("INSERT INTO captures(page_id, device, mode, status, image_key) VALUES ($1,'mobile','fold','done','x.png') RETURNING *", [pg.id]);
    pages.push({ pg, c });
  }
  const [m] = await query(
    "INSERT INTO mockups(title, photo_key, width, height, status, licence_source, licence_type, attribution, attribution_required) VALUES ('Phone, front','p.jpg',3000,3000,'published','https://unsplash.com/x','Unsplash License',$1,$2) RETURNING *",
    [attribution ? 'Photo by Jane Doe on Unsplash' : null, attribution],
  );
  await query("INSERT INTO screens(mockup_id, screen_key, device, corners) VALUES ($1,'s1','mobile','{\"tl\":[0,0],\"tr\":[100,0],\"br\":[100,200],\"bl\":[0,200]}')", [m.id]);
  return { u, project, pages, m };
}

async function finalRender(u: any, projectId: string, mockupId: string, captureId: string) {
  const { render } = (await app.inject({ method: 'POST', url: `/projects/${projectId}/renders`, headers: auth(u), payload: { mockupId, assignments: { s1: { captureId } }, formats: ['png'] } })).json();
  await waitFor(async () => (await query("SELECT 1 FROM renders WHERE id = $1 AND status = 'done'", [render.id])).length > 0);
  return render;
}

describe('[EX-6] ZIP of the whole set with attribution', () => {
  it('re-renders every final render in each format, names files, and adds ATTRIBUTION.txt when required', async () => {
    const { u, project, pages, m } = await setup(true);
    await finalRender(u, project.id, m.id, pages[0].c.id);
    await finalRender(u, project.id, m.id, pages[1].c.id);
    await finalRender(u, project.id, m.id, pages[1].c.id); // duplicate of the same set item
    const res = await app.inject({ method: 'POST', url: `/projects/${project.id}/exports`, headers: auth(u), payload: { formats: ['png', 'jpg', 'webp', 'gif'] } });
    expect(res.statusCode).toBe(202);
    const { jobId, renderIds } = res.json();
    expect(renderIds).toHaveLength(2);
    const [job] = await query('SELECT payload FROM jobs WHERE id = $1', [jobId]);
    const result = await exportJob({ jobId, ...job.payload });
    const zipBuf = await getStorage().get(result.zipKey);
    const zip = await JSZip.loadAsync(zipBuf);
    expect(Object.keys(zip.files).sort()).toEqual([
      'ATTRIBUTION.txt',
      'acme-iq_contact_mobile_phone-front.jpg',
      'acme-iq_contact_mobile_phone-front.png',
      'acme-iq_contact_mobile_phone-front.webp',
      'acme-iq_الرئيسية_mobile_phone-front.jpg',
      'acme-iq_الرئيسية_mobile_phone-front.png',
      'acme-iq_الرئيسية_mobile_phone-front.webp',
    ]);
    const credits = await zip.file('ATTRIBUTION.txt')!.async('string');
    expect(credits).toContain('Photo by Jane Doe on Unsplash');
    expect(credits).toContain('Unsplash License');
    expect(result.zipKey).toMatch(/^exports\/.+\/acme-iq-mockups-/);
  });

  it('leaves ATTRIBUTION.txt out when no licence needs it, and reports status over the API', async () => {
    const { u, project, pages, m } = await setup(false);
    await finalRender(u, project.id, m.id, pages[0].c.id);
    const { jobId } = (await app.inject({ method: 'POST', url: `/projects/${project.id}/exports`, headers: auth(u), payload: { formats: ['png'] } })).json();
    const [job] = await query('SELECT payload FROM jobs WHERE id = $1', [jobId]);
    const result = await exportJob({ jobId, ...job.payload });
    expect(result.files).toEqual(['acme-iq_الرئيسية_mobile_phone-front.png']);
    await query("UPDATE jobs SET status = 'done', result = $2 WHERE id = $1", [jobId, JSON.stringify(result)]);
    const status = (await app.inject({ url: `/projects/${project.id}/exports/${jobId}`, headers: auth(u) })).json();
    expect(status).toMatchObject({ status: 'done', files: result.files });
    expect(status.url).toMatch(/\.zip\?exp=/);
    const empty = await setup(false);
    const none = await app.inject({ method: 'POST', url: `/projects/${empty.project.id}/exports`, headers: auth(empty.u), payload: { formats: ['png'] } });
    expect(none.json().error).toBe('nothing_to_export');
  });
});

describe('[NF-STOR] 30-day retention', () => {
  it('deletes old captures of unsaved projects only', async () => {
    const a = await setup(false);
    const b = await setup(false);
    await query('UPDATE projects SET saved = true WHERE id = $1', [b.project.id]);
    await getStorage().put('x.png', Buffer.from('img'));
    await query("UPDATE captures SET updated_at = now() - interval '31 days'");
    const [fresh] = await query("INSERT INTO captures(page_id, device, mode, status) VALUES ($1,'desktop','fold','done') RETURNING id", [a.pages[0].pg.id]);
    expect(await deleteExpiredCaptures()).toBe(2);
    const left = await query('SELECT id FROM captures');
    expect(left.map((r) => r.id).sort()).toEqual([fresh.id, ...b.pages.map((p) => p.c.id)].sort());
    expect(await getStorage().exists('x.png')).toBe(false);
  });
});
