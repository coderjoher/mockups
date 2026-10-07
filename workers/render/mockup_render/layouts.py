"""CR-5 presentation layouts without photos, and CX-2 backgrounds (solid, gradient, brand colours, padding, shadow)."""
from __future__ import annotations

import math

import cv2
import numpy as np

from .render import rounded_rect_alpha


def parse_colour(value: str) -> tuple[int, int, int]:
    """'#rrggbb' -> BGR tuple."""
    v = value.strip().lstrip("#")
    if len(v) == 3:
        v = "".join(c * 2 for c in v)
    if len(v) != 6 or any(c not in "0123456789abcdefABCDEF" for c in v):
        raise ValueError(f"bad colour {value!r}")
    r, g, b = int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16)
    return (b, g, r)


def background(w: int, h: int, spec: dict | None) -> np.ndarray:
    """CX-2: {"type": "solid", "colour": "#..."} or {"type": "gradient", "from": "#...", "to": "#...", "angle": 135}."""
    spec = spec or {"type": "solid", "colour": "#f4f4f2"}
    if spec.get("type") == "gradient":
        c1 = np.array(parse_colour(spec.get("from", "#f4f4f2")), np.float32)
        c2 = np.array(parse_colour(spec.get("to", "#d9d9d4")), np.float32)
        a = math.radians(float(spec.get("angle", 135)))
        ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
        t = (xs * math.cos(a) + ys * math.sin(a))
        t = (t - t.min()) / max(1e-6, float(t.max() - t.min()))
        return (c1 * (1 - t[:, :, None]) + c2 * t[:, :, None]).astype(np.float32)
    return np.ones((h, w, 3), np.float32) * np.array(parse_colour(spec.get("colour", "#f4f4f2")), np.float32)


def _shadow(canvas: np.ndarray, x: int, y: int, w: int, h: int, radius: float, strength: float):
    if strength <= 0:
        return
    H, W = canvas.shape[:2]
    blur = max(3, int(min(w, h) * 0.06)) | 1
    pad = blur * 2
    m = np.zeros((h + 2 * pad, w + 2 * pad), np.float32)
    m[pad : pad + h, pad : pad + w] = rounded_rect_alpha(w, h, radius)
    m = cv2.GaussianBlur(m, (blur, blur), 0) * min(1.0, strength)
    dy = int(blur * 0.4)
    y0, x0 = y - pad + dy, x - pad
    ys0, xs0 = max(0, -y0), max(0, -x0)
    ys1, xs1 = min(m.shape[0], H - y0), min(m.shape[1], W - x0)
    if ys1 <= ys0 or xs1 <= xs0:
        return
    region = canvas[y0 + ys0 : y0 + ys1, x0 + xs0 : x0 + xs1]
    region *= 1 - 0.55 * m[ys0:ys1, xs0:xs1, None]


def _paste(canvas: np.ndarray, img: np.ndarray, x: int, y: int, radius: float):
    h, w = img.shape[:2]
    a = rounded_rect_alpha(w, h, radius)[:, :, None]
    region = canvas[y : y + h, x : x + w]
    region[:] = region * (1 - a) + img[:, :, :3].astype(np.float32) * a


def _browser_frame(img: np.ndarray, width: int, dark=False) -> np.ndarray:
    """Scales a capture to `width` and adds a minimal browser bar on top."""
    h = int(round(img.shape[0] * width / img.shape[1]))
    body = cv2.resize(img[:, :, :3], (width, h), interpolation=cv2.INTER_AREA)
    bar_h = max(18, width // 28)
    bar = np.full((bar_h, width, 3), (40, 40, 44) if dark else (236, 236, 233), np.uint8)
    r = max(3, bar_h // 6)
    for i, colour in enumerate([(94, 95, 255), (46, 189, 254), (64, 201, 40)]):
        cv2.circle(bar, (bar_h // 2 + i * (r * 3), bar_h // 2), r, colour, -1, cv2.LINE_AA)
    return np.vstack([bar, body])


def grid_collage(images: list[np.ndarray], *, width=2400, columns=None, padding=80, gap=48, radius=14, shadow=0.6, bg=None, crop_aspect=16 / 10) -> np.ndarray:
    """CR-5: a grid of pages, each in a browser frame and cropped to the same aspect."""
    if not images:
        raise ValueError("no pages for the collage")
    n = len(images)
    cols = columns or min(3, max(1, math.ceil(math.sqrt(n))))
    rows = math.ceil(n / cols)
    cell_w = (width - 2 * padding - (cols - 1) * gap) // cols
    framed = []
    for img in images:
        crop_h = int(img.shape[1] / crop_aspect)
        f = _browser_frame(img[:crop_h], cell_w)
        framed.append(f)
    cell_h = max(f.shape[0] for f in framed)
    height = 2 * padding + rows * cell_h + (rows - 1) * gap
    canvas = background(width, height, bg)
    for i, f in enumerate(framed):
        r, c = divmod(i, cols)
        x = padding + c * (cell_w + gap)
        y = padding + r * (cell_h + gap)
        _shadow(canvas, x, y, f.shape[1], f.shape[0], radius, shadow)
        _paste(canvas, f, x, y, radius)
    return np.clip(np.rint(canvas), 0, 255).astype(np.uint8)


def tall_frame(image: np.ndarray, *, width=1600, max_height=6000, padding=100, radius=18, shadow=0.6, bg=None) -> np.ndarray:
    """CR-5: one full-page capture in a tall browser frame."""
    inner_w = width - 2 * padding
    f = _browser_frame(image, inner_w)
    f = f[: max_height - 2 * padding]
    canvas = background(width, f.shape[0] + 2 * padding, bg)
    _shadow(canvas, padding, padding, f.shape[1], f.shape[0], radius, shadow)
    _paste(canvas, f, padding, padding, radius)
    return np.clip(np.rint(canvas), 0, 255).astype(np.uint8)
