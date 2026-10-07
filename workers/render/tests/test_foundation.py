"""[F-1] render worker runs; [F-4] it consumes BullMQ `render` jobs and mirrors status into Postgres."""
import asyncio
import json
import uuid

import psycopg
import pytest
from bullmq import Queue

from mockup_render import config, worker
from mockup_render.storage import LocalStorage


def _db():
    return psycopg.connect(config.DATABASE_URL, autocommit=True)


def _schema_ready():
    try:
        with _db() as c:
            return c.execute("SELECT to_regclass('public.jobs')").fetchone()[0] is not None
    except Exception:
        return False


needs_db = pytest.mark.skipif(not _schema_ready(), reason="test database not migrated (run npm run test:node first)")


async def _enqueue(data, attempts=1):
    job_id = str(uuid.uuid4())
    with _db() as c:
        c.execute("INSERT INTO jobs(id, type, payload) VALUES (%s, 'render', %s)", (job_id, json.dumps(data)))
    q = Queue("render", {"connection": config.REDIS_URL, "prefix": config.QUEUE_PREFIX})
    await q.add("render", {"jobId": job_id, **data}, {"jobId": job_id, "attempts": attempts, "backoff": {"type": "fixed", "delay": 50}})
    await q.close()
    return job_id


def _row(job_id):
    with _db() as c:
        return c.execute("SELECT status, attempts, result, error FROM jobs WHERE id=%s", (job_id,)).fetchone()


async def _wait(job_id, status, timeout=15):
    for _ in range(int(timeout / 0.05)):
        row = _row(job_id)
        if row and row[0] == status:
            return row
        await asyncio.sleep(0.05)
    raise AssertionError(f"job {job_id} never reached {status}: {_row(job_id)}")


@needs_db
def test_f1_f4_render_worker_processes_jobs_and_mirrors_status():
    async def run():
        w = worker.make_worker()
        try:
            ok = await _enqueue({"kind": "ping", "value": 7})
            row = await _wait(ok, "done")
            assert row[1] == 1 and row[2] == {"pong": 7}
            bad = await _enqueue({"kind": "nope"}, attempts=3)
            row = await _wait(bad, "failed")
            assert row[1] == 3 and "unknown render job kind" in row[3]
        finally:
            await w.close()

    asyncio.run(run())


def test_f6_local_storage_roundtrip(tmp_path):
    s = LocalStorage(str(tmp_path))
    s.put("renders/a.png", b"abc")
    assert s.get("renders/a.png") == b"abc"
    s.delete("renders/a.png")
    with pytest.raises(FileNotFoundError):
        s.get("renders/a.png")
    with pytest.raises(ValueError):
        s.put("../x", b"")
