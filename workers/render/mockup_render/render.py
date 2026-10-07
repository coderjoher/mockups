"""Composition and rendering (PRD "Composition and rendering", steps 1-6).

All maths happens in float32 with fixed interpolation flags so the same inputs always give the same bytes (CR-7).
"""
from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

cv2.setNumThreads(1)  # deterministic, and parallelism comes from running several workers

CORNER_ORDER = ("tl", "tr", "br", "bl")


@dataclass
class Screen:
    key: str
    device: str
    corners: dict  # {"tl": [x, y], ...} in photo pixels
    corner_radius: float = 0.0
    mask: np.ndarray | None = None  # single-channel 0-255, any size; stretched over the screen
    z_index: int = 1

    def quad(self) -> np.ndarray:
        return np.array([self.corners[k] for k in CORNER_ORDER], dtype=np.float32)

    def size(self) -> tuple[float, float]:
        """Screen width and height in photo pixels, averaged over opposite edges."""
        q = self.quad()
        w = (np.linalg.norm(q[1] - q[0]) + np.linalg.norm(q[2] - q[3])) / 2
        h = (np.linalg.norm(q[3] - q[0]) + np.linalg.norm(q[2] - q[1])) / 2
        return float(w), float(h)


@dataclass
class Assignment:
    image: np.ndarray  # BGR or BGRA capture
    scroll_offset: int = 0  # capture pixels from the top (CR-3)


@dataclass
class Scene:
    photo: np.ndarray  # BGR(A)
    screens: list[Screen]
    overlay: np.ndarray | None = None  # BGRA, drawn on top (CP-5)
    light_map: np.ndarray | None = None  # BGR/gray, multiplied over the screens (CP-6)
    background: tuple[int, int, int] | None = None


def crop_to_aspect(img: np.ndarray, aspect: float, offset: int = 0) -> np.ndarray:
    """Step 2: crop the capture to the screen's aspect ratio, from the top (plus scroll offset). Never stretches."""
    h, w = img.shape[:2]
    if w / h > aspect:
        # Capture is wider than the screen: keep full height, crop the sides evenly.
        cw = max(1, int(round(h * aspect)))
        x0 = (w - cw) // 2
        return img[:, x0 : x0 + cw]
    ch = max(1, int(round(w / aspect)))
    y0 = int(np.clip(offset, 0, h - ch))
    return img[y0 : y0 + ch, :]


def rounded_rect_alpha(w: int, h: int, radius: float) -> np.ndarray:
    """Float32 alpha (0..1) of a rounded rectangle with a 1 px anti-aliased edge.

    Only the four corner patches differ from 1, so only they are computed (one patch, mirrored).
    """
    a = np.ones((h, w), np.float32)
    r = float(max(0.0, min(radius, w / 2, h / 2)))
    if r <= 0:
        return a
    n = min(int(np.ceil(r)) + 1, w, h)
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32)
    xs += 0.5
    ys += 0.5
    dist = np.sqrt((xs - np.maximum(xs, r)) ** 2 + (ys - np.maximum(ys, r)) ** 2)
    patch = np.clip(r - dist + 0.5, 0.0, 1.0).astype(np.float32)
    a[:n, :n] = np.minimum(a[:n, :n], patch)
    a[:n, w - n :] = np.minimum(a[:n, w - n :], patch[:, ::-1])
    a[h - n :, :n] = np.minimum(a[h - n :, :n], patch[::-1, :])
    a[h - n :, w - n :] = np.minimum(a[h - n :, w - n :], patch[::-1, ::-1])
    return a


def homography(src_w: int, src_h: int, quad: np.ndarray) -> np.ndarray:
    """Step 3: the perspective transform from the crop rectangle onto the four screen corners."""
    src = np.array([[0, 0], [src_w, 0], [src_w, src_h], [0, src_h]], dtype=np.float32)
    return cv2.getPerspectiveTransform(src, quad.astype(np.float32))


def _to_bgra(img: np.ndarray) -> np.ndarray:
    if img.ndim == 2:
        return cv2.cvtColor(img, cv2.COLOR_GRAY2BGRA)
    if img.shape[2] == 3:
        return cv2.cvtColor(img, cv2.COLOR_BGR2BGRA)
    return img


def warp_screen(capture: np.ndarray, screen: Screen, out_w: int, out_h: int, scroll_offset: int = 0) -> tuple[np.ndarray, np.ndarray, tuple[int, int]]:
    """Warps one screen. Returns (BGR float32, alpha float32 0..1, (x0, y0)) covering only the screen's bounding box."""
    sw, sh = screen.size()
    crop = crop_to_aspect(_to_bgra(capture), sw / sh, scroll_offset)
    # Resample to about the on-photo size first (INTER_AREA avoids moire when shrinking), then warp bicubically.
    tw, th = max(2, int(round(sw))), max(2, int(round(sh)))
    interp = cv2.INTER_AREA if crop.shape[1] > tw else cv2.INTER_CUBIC
    src = cv2.resize(crop, (tw, th), interpolation=interp)
    alpha = rounded_rect_alpha(tw, th, screen.corner_radius)
    alpha *= src[:, :, 3].astype(np.float32) / 255.0
    if screen.mask is not None:
        m = cv2.resize(screen.mask, (tw, th), interpolation=cv2.INTER_LINEAR).astype(np.float32) / 255.0
        alpha *= m
    quad = screen.quad()
    # Only the screen's bounding box (plus a margin for the soft edge) is warped and blended.
    x0 = int(max(0, np.floor(quad[:, 0].min()) - 2))
    y0 = int(max(0, np.floor(quad[:, 1].min()) - 2))
    x1 = int(min(out_w, np.ceil(quad[:, 0].max()) + 3))
    y1 = int(min(out_h, np.ceil(quad[:, 1].max()) + 3))
    if x1 <= x0 or y1 <= y0:
        return np.zeros((0, 0, 3), np.float32), np.zeros((0, 0), np.float32), (0, 0)
    H = homography(tw, th, quad - np.array([x0, y0], np.float32))
    # Pad by one transparent pixel so the warp has a soft (anti-aliased) boundary instead of a hard cut (CR-1).
    pad = 1
    src_p = cv2.copyMakeBorder(src[:, :, :3], pad, pad, pad, pad, cv2.BORDER_REPLICATE)
    alpha_p = cv2.copyMakeBorder(alpha, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=0.0)
    shift = np.array([[1, 0, -pad], [0, 1, -pad], [0, 0, 1]], dtype=np.float64)
    Hp = H @ shift
    size = (x1 - x0, y1 - y0)
    color = cv2.warpPerspective(src_p, Hp, size, flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    a = cv2.warpPerspective(alpha_p, Hp, size, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0.0)
    return color.astype(np.float32), np.clip(a, 0.0, 1.0), (x0, y0)


def compose(scene: Scene, assignments: dict[str, Assignment], scale: float = 1.0) -> np.ndarray:
    """Steps 4-6: base photo -> screens by z-index -> light map (multiply) -> overlay. Returns BGR uint8.

    The photo stays uint8; only each screen's bounding box is blended in float32, so a 6000 px photo stays fast.
    """
    photo = scene.photo
    if scale != 1.0:
        photo = cv2.resize(photo, (max(1, round(photo.shape[1] * scale)), max(1, round(photo.shape[0] * scale))), interpolation=cv2.INTER_AREA)
    h, w = photo.shape[:2]
    out = photo.copy() if photo.ndim == 3 and photo.shape[2] == 3 else np.ascontiguousarray(_to_bgra(photo)[:, :, :3])
    light = None
    if scene.light_map is not None:
        lm = scene.light_map if scene.light_map.ndim == 3 else cv2.cvtColor(scene.light_map, cv2.COLOR_GRAY2BGR)
        light = cv2.resize(lm[:, :, :3], (w, h), interpolation=cv2.INTER_AREA)
    for screen in sorted(scene.screens, key=lambda s: (s.z_index, s.key)):
        a = assignments.get(screen.key)
        if a is None:
            continue
        s = screen if scale == 1.0 else _scaled(screen, scale)
        color, alpha, (x0, y0) = warp_screen(a.image, s, w, h, a.scroll_offset)
        if not alpha.size:
            continue
        ys, xs = slice(y0, y0 + alpha.shape[0]), slice(x0, x0 + alpha.shape[1])
        if light is not None:
            color = color * (light[ys, xs].astype(np.float32) / 255.0)
        alpha3 = alpha[:, :, None]
        blended = out[ys, xs].astype(np.float32) * (1.0 - alpha3) + color * alpha3
        out[ys, xs] = np.clip(np.rint(blended), 0, 255).astype(np.uint8)
    if scene.overlay is not None:
        ov = cv2.resize(_to_bgra(scene.overlay), (w, h), interpolation=cv2.INTER_AREA)
        nz = np.argwhere(ov[:, :, 3] > 0)
        if len(nz):
            (y0, x0), (y1, x1) = nz.min(0), nz.max(0) + 1
            region = ov[y0:y1, x0:x1].astype(np.float32)
            oa = region[:, :, 3:4] / 255.0
            blended = out[y0:y1, x0:x1].astype(np.float32) * (1.0 - oa) + region[:, :, :3] * oa
            out[y0:y1, x0:x1] = np.clip(np.rint(blended), 0, 255).astype(np.uint8)
    return out


def _scaled(screen: Screen, scale: float) -> Screen:
    return Screen(
        key=screen.key,
        device=screen.device,
        corners={k: [v[0] * scale, v[1] * scale] for k, v in screen.corners.items()},
        corner_radius=screen.corner_radius * scale,
        mask=screen.mask,
        z_index=screen.z_index,
    )
