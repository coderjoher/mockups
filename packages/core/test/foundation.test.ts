import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, one, query } from '../src/db';
import { applied, migrateDown, migrateUp } from '../src/migrate';
import { closeQueues, enqueue, getJob, startWorker, JOB_TYPES, type JobType } from '../src/queue';
import { LocalStorage, verifySignedKey } from '../src/storage';
import { hashPassword, signSession, verifyPassword, verifySession } from '../src/auth';
import { resetDb, resetRedis, waitFor, makeUser } from '../../../tests/setup/helpers';
import type { Worker } from 'bullmq';

afterAll(async () => {
  await closeQueues();
  await closePool();
});

describe('[F-3] schema and migrations', () => {
  it('rolls every migration back and re-applies it cleanly', async () => {
    const before = await applied();
    expect(before.length).toBeGreaterThan(0);
    await migrateDown();
    expect(await applied()).toEqual([]);
    const tables = await query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'schema_migrations'");
    expect(tables).toEqual([]);
    await migrateUp();
    expect(await applied()).toEqual(before);
  });

  it('stores every PRD entity with its relations', async () => {
    await resetDb();
    const user = await makeUser('admin');
    const project = await one('INSERT INTO projects(workspace_id, owner_id, root_url, title) VALUES ($1,$2,$3,$4) RETURNING *', [user.workspace_id, user.id, 'https://example.com/', 'Example']);
    const page = await one('INSERT INTO pages(project_id, url, title, selected) VALUES ($1,$2,$3,true) RETURNING *', [project.id, 'https://example.com/', 'Home']);
    await one("INSERT INTO captures(page_id, device, mode, options) VALUES ($1,'mobile','fold','{\"dark\":false}') RETURNING *", [page.id]);
    const mockup = await one("INSERT INTO mockups(title, photo_key, width, height, tags) VALUES ('Desk', 'p.jpg', 4000, 3000, '{desk,laptop}') RETURNING *");
    await one(
      "INSERT INTO screens(mockup_id, screen_key, device, corners, corner_radius, mask_key, z_index) VALUES ($1,'s1','mobile',$2,38,'masks/iphone-notch.png',1)",
      [mockup.id, { tl: [1204, 388], tr: [1712, 402], br: [1690, 1466], bl: [1182, 1450] }],
    );
    await one("INSERT INTO renders(project_id, mockup_id, assignments) VALUES ($1,$2,'{\"s1\":{\"captureId\":\"x\",\"scrollOffset\":0}}')", [project.id, mockup.id]);

    const tree = await one(
      `SELECT p.title, (SELECT count(*) FROM pages WHERE project_id = p.id) AS pages,
              (SELECT count(*) FROM captures c JOIN pages pg ON pg.id = c.page_id WHERE pg.project_id = p.id) AS captures,
              (SELECT count(*) FROM renders WHERE project_id = p.id) AS renders
         FROM projects p WHERE p.id = $1`,
      [project.id],
    );
    expect(tree).toMatchObject({ title: 'Example', pages: 1, captures: 1, renders: 1 });
    const screen = await one('SELECT * FROM screens WHERE mockup_id = $1', [mockup.id]);
    expect(screen.corners.tl).toEqual([1204, 388]);

    // Cascades: deleting the project removes its pages, captures and renders.
    await query('DELETE FROM projects WHERE id = $1', [project.id]);
    expect((await one('SELECT count(*) AS n FROM captures')).n).toBe(0);
  });

  it('rejects invalid enum values', async () => {
    await expect(query("INSERT INTO mockups(title, photo_key, width, height, status) VALUES ('x','y',1,1,'live')")).rejects.toThrow();
  });
});

describe('[F-4] job queue', () => {
  let workers: Worker[] = [];
  beforeEach(async () => {
    await resetDb();
    await resetRedis();
  });
  afterAll(async () => {
    for (const w of workers) await w.close();
  });

  it('runs a job of every type and mirrors queued -> running -> done into Postgres', async () => {
    const seen: string[] = [];
    const ids: Record<string, string> = {};
    // Enqueue first: with no worker running yet every job must sit in Postgres as queued.
    for (const t of JOB_TYPES) {
      ids[t] = await enqueue(t, { n: 1 });
      expect((await getJob(ids[t]))!.status).toBe('queued');
    }
    workers = JOB_TYPES.map((t) =>
      startWorker(t, async (data) => {
        const row = await getJob(data.jobId);
        seen.push(`${t}:${row!.status}`);
        return { ok: t };
      }),
    );
    for (const t of JOB_TYPES) {
      const job = await waitFor(async () => {
        const j = await getJob(ids[t]);
        return j?.status === 'done' && j;
      });
      expect(job.result).toEqual({ ok: t });
      expect(job.attempts).toBe(1);
      expect(job.started_at).not.toBeNull();
      expect(job.finished_at).not.toBeNull();
    }
    expect(seen.sort()).toEqual(JOB_TYPES.map((t) => `${t}:running`).sort());
    for (const w of workers) await w.close();
    workers = [];
  });
});

describe('[F-5] retries and isolation', () => {
  beforeEach(async () => {
    await resetDb();
    await resetRedis();
  });

  it('retries a failing job twice with growing backoff, then marks it failed; a sibling still completes', async () => {
    const attemptsAt: number[] = [];
    const worker = startWorker(
      'capture' as JobType,
      async (data) => {
        if (data.fail) {
          attemptsAt.push(Date.now());
          throw new Error('boom');
        }
        return 'fine';
      },
      { concurrency: 2 },
    );
    const bad = await enqueue('capture', { fail: true });
    const good = await enqueue('capture', { fail: false });
    const failed = await waitFor(async () => {
      const j = await getJob(bad);
      return j?.status === 'failed' && j;
    });
    expect(failed.attempts).toBe(3);
    expect(failed.error).toBe('boom');
    expect(attemptsAt).toHaveLength(3);
    const gap1 = attemptsAt[1] - attemptsAt[0];
    const gap2 = attemptsAt[2] - attemptsAt[1];
    expect(gap1).toBeGreaterThanOrEqual(90);
    expect(gap2).toBeGreaterThan(gap1);
    expect(await getJob(good)).toMatchObject({ status: 'done', result: 'fine', attempts: 1 });
    await worker.close();
  });
});

describe('[F-6] object storage', () => {
  it('stores, reads, signs and deletes files; signatures expire', async () => {
    const s = new LocalStorage('.data/test-storage', 'http://api.test');
    await s.put('captures/a/b.png', Buffer.from('png-bytes'));
    expect((await s.get('captures/a/b.png')).toString()).toBe('png-bytes');
    const url = new URL(await s.signedUrl('captures/a/b.png', 60));
    expect(url.pathname).toBe('/files/captures/a/b.png');
    const exp = Number(url.searchParams.get('exp'));
    const sig = url.searchParams.get('sig')!;
    expect(verifySignedKey('captures/a/b.png', exp, sig)).toBe(true);
    expect(verifySignedKey('captures/a/other.png', exp, sig)).toBe(false);
    expect(verifySignedKey('captures/a/b.png', exp, sig, (exp + 1) * 1000)).toBe(false);
    await s.delete('captures/a/b.png');
    expect(await s.exists('captures/a/b.png')).toBe(false);
    await expect(s.put('../escape.txt', Buffer.from('x'))).rejects.toThrow('invalid storage key');
  });
});

describe('auth primitives', () => {
  it('hashes passwords and signs sessions', async () => {
    const h = await hashPassword('pw-1');
    expect(await verifyPassword('pw-1', h)).toBe(true);
    expect(await verifyPassword('pw-2', h)).toBe(false);
    expect(await verifyPassword('pw-1', 'garbage')).toBe(false);
    const t = signSession('user-1');
    expect(verifySession(t)).toBe('user-1');
    expect(verifySession(t.replace(/.$/, t.endsWith('A') ? 'B' : 'A'))).toBeNull();
    expect(verifySession(t, Date.now() + 15 * 24 * 3600 * 1000)).toBeNull();
    expect(verifySession(undefined)).toBeNull();
  });
});
