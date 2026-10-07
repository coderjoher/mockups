"""Render job handlers: mockup thumbnails and screen compositing."""
import json

import cv2
import numpy as np
import psycopg
from psycopg.rows import dict_row

from . import config
from .storage import get_storage
from .registry import handler

THUMB_LONG_SIDE = 800
PREVIEW_LONG_SIDE = 1600  # CR-6: previews render at reduced size


def _db():
    return psycopg.connect(config.DATABASE_URL, autocommit=True, row_factory=dict_row)


def decode(buf: bytes, flags=cv2.IMREAD_UNCHANGED) -> np.ndarray:
    img = cv2.imdecode(np.frombuffer(buf, np.uint8), flags)
    if img is None:
        raise ValueError("image could not be decoded")
    return img


def encode(img: np.ndarray, fmt: str, quality: int = 90) -> bytes:
    """Deterministic encoders (CR-7): fixed parameters, no timestamps."""
    if fmt == "png":
        ok, buf = cv2.imencode(".png", img, [cv2.IMWRITE_PNG_COMPRESSION, 6])
    elif fmt == "jpg":
        ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality, cv2.IMWRITE_JPEG_OPTIMIZE, 1])
    elif fmt == "webp":
        ok, buf = cv2.imencode(".webp", img, [cv2.IMWRITE_WEBP_QUALITY, 101])  # 101 = lossless
    else:
        raise ValueError(f"unknown format {fmt}")
    if not ok:
        raise ValueError(f"could not encode {fmt}")
    return buf.tobytes()


@handler("thumbnail")
def thumbnail(data):
    with _db() as c:
        m = c.execute("SELECT id, photo_key FROM mockups WHERE id = %s", (data["mockupId"],)).fetchone()
        if not m:
            return {"skipped": "mockup deleted"}
        img = decode(get_storage().get(m["photo_key"]), cv2.IMREAD_COLOR)
        h, w = img.shape[:2]
        s = THUMB_LONG_SIDE / max(w, h)
        thumb = cv2.resize(img, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA)
        key = f"mockups/{m['id']}/thumb.jpg"
        get_storage().put(key, encode(thumb, "jpg", 85), "image/jpeg")
        c.execute("UPDATE mockups SET thumb_key = %s WHERE id = %s", (key, m["id"]))
    return {"thumb": key}
