"""[CP-1] thumbnails for uploaded photos; [SEED] placeholder library."""
import asyncio
import json
import os
import uuid

import cv2
import numpy as np
import psycopg
import pytest
from bullmq import Queue

from mockup_render import config, seed, worker
from mockup_render.storage import LocalStorage

from .test_foundation import _db, _wait, needs_db


@needs_db
def test_cp1_thumbnail_job_writes_a_small_jpeg(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "STORAGE_DIR", str(tmp_path))
    monkeypatch.setattr("mockup_render.storage._storage", None)
    photo = np.full((2000, 3200, 3), (40, 120, 200), np.uint8)
    LocalStorage(str(tmp_path)).put("mockups/t/photo.png", cv2.imencode(".png", photo)[1].tobytes())
    mockup_id = str(uuid.uuid4())
    job_id = str(uuid.uuid4())
    with _db() as c:
        c.execute("INSERT INTO mockups(id, title, photo_key, width, height) VALUES (%s, 'T', 'mockups/t/photo.png', 3200, 2000)", (mockup_id,))
        c.execute("INSERT INTO jobs(id, type, payload) VALUES (%s, 'render', '{}')", (job_id,))

    async def run():
        w = worker.make_worker()
        q = Queue("render", {"connection": config.REDIS_URL, "prefix": config.QUEUE_PREFIX})
        await q.add("render", {"jobId": job_id, "kind": "thumbnail", "mockupId": mockup_id}, {"jobId": job_id, "attempts": 1})
        await q.close()
        try:
            await _wait(job_id, "done")
        finally:
            await w.close()

    asyncio.run(run())
    with _db() as c:
        key = c.execute("SELECT thumb_key FROM mockups WHERE id=%s", (mockup_id,)).fetchone()[0]
        c.execute("DELETE FROM mockups WHERE id=%s", (mockup_id,))
    thumb = cv2.imdecode(np.frombuffer(open(os.path.join(tmp_path, key), "rb").read(), np.uint8), cv2.IMREAD_COLOR)
    assert key.endswith("thumb.jpg")
    assert thumb.shape[:2] == (500, 800)


def _convex_clockwise(c):
    p = [c[k] for k in ("tl", "tr", "br", "bl")]
    for i in range(4):
        o, a, b = p[i], p[(i + 1) % 4], p[(i + 2) % 4]
        if (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]) <= 0:
            return False
    return True


def test_seed_generates_at_least_ten_valid_scenes(tmp_path):
    manifest = seed.generate(str(tmp_path))
    assert 10 <= len(manifest) <= 15
    kinds = {m["device_type"] for m in manifest}
    assert {"desktop", "laptop", "tablet", "mobile", "multi"} <= kinds
    for m in manifest:
        img = cv2.imread(m["file"])
        assert img.shape[1] == m["width"] and img.shape[0] == m["height"]
        assert max(img.shape[:2]) >= 3000
        for s in m["screens"]:
            c = s["corners"]
            assert _convex_clockwise(c), (m["slug"], s)
            assert all(0 <= x <= m["width"] and 0 <= y <= m["height"] for x, y in c.values())
            # The screen area is the dark glass that was drawn there.
            cx = int(sum(x for x, _ in c.values()) / 4)
            cy = int(sum(y for _, y in c.values()) / 4)
            assert img[cy, cx].max() < 40, (m["slug"], s["screenId"], img[cy, cx])
    assert json.load(open(os.path.join(tmp_path, "manifest.json")))[0]["slug"] == manifest[0]["slug"]
