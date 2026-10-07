"""BullMQ consumer for the `render` queue. Mirrors job state into the Postgres `jobs` table."""
import asyncio
import json
import signal

import psycopg
from bullmq import Worker

from . import config

HANDLERS = {}


def handler(kind):
    def register(fn):
        HANDLERS[kind] = fn
        return fn

    return register


@handler("ping")
def _ping(data):
    return {"pong": data.get("value")}


def _db():
    return psycopg.connect(config.DATABASE_URL, autocommit=True)


def _set(job_id, sql, params=()):
    with _db() as conn:
        conn.execute(sql, (*params, job_id))


async def process(job, token=None):
    data = job.data
    job_id = data["jobId"]
    attempt = job.attemptsMade + 1
    await asyncio.to_thread(
        _set, job_id, "UPDATE jobs SET status='running', attempts=%s, started_at=now(), error=NULL WHERE id=%s", (attempt,)
    )
    try:
        fn = HANDLERS.get(data.get("kind", "render"))
        if fn is None:
            raise ValueError(f"unknown render job kind {data.get('kind')!r}")
        result = await asyncio.to_thread(fn, data)
    except Exception as err:  # noqa: BLE001 - every failure is recorded, then BullMQ retries
        final = attempt >= int(job.opts.get("attempts", 1))
        await asyncio.to_thread(
            _set,
            job_id,
            "UPDATE jobs SET status=%s, error=%s, finished_at=CASE WHEN %s THEN now() ELSE NULL END WHERE id=%s",
            ("failed" if final else "queued", str(err), final),
        )
        raise
    await asyncio.to_thread(
        _set, job_id, "UPDATE jobs SET status='done', result=%s, finished_at=now() WHERE id=%s", (json.dumps(result),)
    )
    return result


def make_worker(concurrency=2):
    # Importing the render module registers its handlers.
    from . import jobs  # noqa: F401

    return Worker(
        "render",
        process,
        {"connection": config.REDIS_URL, "prefix": config.QUEUE_PREFIX, "concurrency": concurrency},
    )


async def main():
    worker = make_worker()
    print("render worker ready", flush=True)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    await stop.wait()
    await worker.close()


if __name__ == "__main__":
    asyncio.run(main())
