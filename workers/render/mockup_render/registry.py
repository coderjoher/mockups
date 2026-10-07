"""Job handler registry, kept apart from worker.py so `python -m mockup_render.worker` sees the same handlers."""
HANDLERS = {}


def handler(kind):
    def register(fn):
        HANDLERS[kind] = fn
        return fn

    return register


@handler("ping")
def _ping(data):
    return {"pong": data.get("value")}
