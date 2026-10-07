"""Render job handlers: mockup thumbnails and screen compositing."""
import json

import cv2
import numpy as np
import psycopg
from psycopg.rows import dict_row

from . import config
from .storage import get_storage
from .registry import handler
from .layouts import grid_collage, tall_frame
from .presets import add_headline, fit_preset
from .video import scrolling_video
from .render import Assignment, Scene, Screen, compose

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


def _load_mask(buf: bytes) -> np.ndarray:
    """Mask PNG: alpha channel if present, otherwise brightness (white = screen visible)."""
    img = decode(buf, cv2.IMREAD_UNCHANGED)
    if img.ndim == 3 and img.shape[2] == 4:
        return img[:, :, 3]
    if img.ndim == 3:
        return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return img


def build_scene(c, mockup, use_overlay=True, use_light_map=True) -> Scene:
    storage = get_storage()
    rows = c.execute(
        "SELECT screen_key, device, corners, corner_radius, mask_key, z_index FROM screens WHERE mockup_id = %s ORDER BY z_index, screen_key",
        (mockup["id"],),
    ).fetchall()
    screens = [
        Screen(
            key=r["screen_key"],
            device=r["device"],
            corners=r["corners"],
            corner_radius=float(r["corner_radius"]),
            mask=_load_mask(storage.get(r["mask_key"])) if r["mask_key"] else None,
            z_index=r["z_index"],
        )
        for r in rows
    ]
    return Scene(
        photo=decode(storage.get(mockup["photo_key"]), cv2.IMREAD_COLOR),
        screens=screens,
        overlay=decode(storage.get(mockup["overlay_key"])) if use_overlay and mockup.get("overlay_key") else None,
        light_map=decode(storage.get(mockup["light_map_key"]), cv2.IMREAD_COLOR) if use_light_map and mockup.get("light_map_key") else None,
    )


@handler("render")
def render_job(data):
    render_id = data["renderId"]
    storage = get_storage()
    with _db() as c:
        r = c.execute("SELECT * FROM renders WHERE id = %s", (render_id,)).fetchone()
        if not r:
            return {"skipped": "render deleted"}
        c.execute("UPDATE renders SET status = 'running', error = NULL WHERE id = %s", (render_id,))
        try:
            opts = r["options"] or {}
            preview = bool(opts.get("preview"))
            if r["layout"] == "video":
                # EX-5: scrolling MP4 of one full-page capture.
                cid = (r["assignments"] or {}).get("pages", [{}])[0].get("captureId")
                cap = c.execute("SELECT image_key FROM captures WHERE id = %s AND status = 'done'", (cid,)).fetchone()
                if not cap:
                    raise ValueError("The capture for the video is missing")
                video = scrolling_video(decode(storage.get(cap["image_key"]), cv2.IMREAD_COLOR), opts.get("videoPreset") or "slide", opts.get("bg"))
                key = f"renders/{r['project_id']}/{render_id}/scroll.mp4"
                storage.put(key, video, "video/mp4")
                c.execute("UPDATE renders SET status = 'done', outputs = %s WHERE id = %s", (json.dumps({"mp4": key}), render_id))
                return {"outputs": {"mp4": key}}
            if r["layout"] in ("grid", "tall"):
                out = render_layout(c, r, opts)
                if preview and max(out.shape[:2]) > PREVIEW_LONG_SIDE:
                    s = PREVIEW_LONG_SIDE / max(out.shape[:2])
                    out = cv2.resize(out, (round(out.shape[1] * s), round(out.shape[0] * s)), interpolation=cv2.INTER_AREA)
            else:
                mockup = c.execute("SELECT * FROM mockups WHERE id = %s", (r["mockup_id"],)).fetchone()
                if not mockup:
                    raise ValueError("The mockup was deleted")
                scene = build_scene(c, mockup, opts.get("overlay", True), opts.get("lightMap", True))
                assignments = {}
                for screen_key, a in (r["assignments"] or {}).items():
                    cap = c.execute("SELECT image_key FROM captures WHERE id = %s AND status = 'done'", (a["captureId"],)).fetchone()
                    if cap and cap["image_key"]:
                        assignments[screen_key] = Assignment(decode(storage.get(cap["image_key"]), cv2.IMREAD_UNCHANGED), int(a.get("scrollOffset") or 0))
                h, w = scene.photo.shape[:2]
                scale = min(1.0, PREVIEW_LONG_SIDE / max(w, h)) if preview else 1.0
                out = compose(scene, assignments, scale)
            outputs = {}
            if preview:
                key = f"renders/{r['project_id']}/{render_id}/preview.jpg"
                storage.put(key, encode(out, "jpg", 85), "image/jpeg")
                outputs["preview"] = key
            else:
                formats = opts.get("formats") or ["png"]
                for fmt in formats:
                    key = f"renders/{r['project_id']}/{render_id}/native.{fmt}"
                    storage.put(key, encode(out, fmt, 90), CONTENT_TYPES[fmt])
                    outputs[fmt] = key
                # EX-2: social and slide sizes on the chosen background (CX-2).
                for preset in opts.get("presets") or []:
                    sized = fit_preset(out, preset, opts.get("bg"))
                    for fmt in formats:
                        key = f"renders/{r['project_id']}/{render_id}/{preset}.{fmt}"
                        storage.put(key, encode(sized, fmt, 90), CONTENT_TYPES[fmt])
                        outputs[f"{preset}.{fmt}"] = key
            c.execute(
                "UPDATE renders SET status = 'done', outputs = %s WHERE id = %s",
                (json.dumps(outputs), render_id),
            )
            return {"outputs": outputs, "width": out.shape[1], "height": out.shape[0]}
        except Exception as err:
            c.execute("UPDATE renders SET status = 'failed', error = %s WHERE id = %s", (str(err)[:500], render_id))
            raise


CONTENT_TYPES = {"png": "image/png", "jpg": "image/jpeg", "webp": "image/webp"}


def render_layout(c, r, opts) -> np.ndarray:
    """CR-5 / CX-2: photo-free layouts. assignments = {"pages": [{"captureId": ...}, ...]}."""
    storage = get_storage()
    ids = [p["captureId"] for p in (r["assignments"] or {}).get("pages", [])]
    images = []
    for cid in ids:
        cap = c.execute("SELECT image_key FROM captures WHERE id = %s AND status = 'done'", (cid,)).fetchone()
        if cap and cap["image_key"]:
            images.append(decode(storage.get(cap["image_key"]), cv2.IMREAD_COLOR))
    if not images:
        raise ValueError("No captured pages to lay out")
    style = {k: opts[k] for k in ("padding", "shadow", "bg") if k in opts}
    out = tall_frame(images[0], **style) if r["layout"] == "tall" else grid_collage(images, **style)
    # CX-4: optional headline and client logo.
    logo = decode(storage.get(opts["logoKey"]), cv2.IMREAD_UNCHANGED) if opts.get("logoKey") else None
    if opts.get("headline") or logo is not None:
        out = add_headline(out, opts.get("headline"), logo)
    return out
