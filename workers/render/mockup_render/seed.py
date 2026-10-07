"""SEED: procedurally drawn placeholder mockup photos with exactly known screen corners.

They let the whole flow run before BeCorp shoots or buys real photos (PRD open question). Each scene is
>= 3000 px on the long side, published with an in-house licence, and replaceable through the admin picker.
"""
from __future__ import annotations

import json
import os
import sys

import cv2
import numpy as np

from .render import rounded_rect_alpha

RNG_SEED = 20261007


def _bg(w, h, top, bottom, noise=6, seed=0):
    rng = np.random.default_rng(RNG_SEED + seed)
    t = np.linspace(0, 1, h, dtype=np.float32)[:, None, None]
    img = (np.array(top, np.float32) * (1 - t) + np.array(bottom, np.float32) * t) * np.ones((1, w, 1), np.float32)
    img += rng.normal(0, noise, (h, w, 1)).astype(np.float32)
    return img


def _desk(img, y0, colour, seed=1):
    """A table top from y0 to the bottom with a soft wood-like grain."""
    h, w = img.shape[:2]
    rng = np.random.default_rng(RNG_SEED + seed)
    grain = cv2.resize(rng.normal(0, 1, (8, max(2, w // 40))).astype(np.float32), (w, h - y0), interpolation=cv2.INTER_CUBIC)
    top = np.array(colour, np.float32) + grain[:, :, None] * 9
    shade = np.linspace(1.0, 0.82, h - y0, dtype=np.float32)[:, None, None]
    img[y0:] = top * shade


def _blend(img, layer, alpha):
    a = alpha[:, :, None]
    img[:] = img * (1 - a) + layer * a


def _shadow(img, quad, blur, strength, offset=(0, 0)):
    """Soft drop shadow. Drawn and blurred at quarter size (fast), then scaled up."""
    h, w = img.shape[:2]
    f = 4
    m = np.zeros((h // f, w // f), np.float32)
    q = ((np.array(quad, np.float32) + np.array(offset, np.float32)) / f).astype(np.int32)
    cv2.fillConvexPoly(m, q, 1.0, lineType=cv2.LINE_AA)
    k = (blur // f) | 1
    m = cv2.resize(cv2.GaussianBlur(m, (k, k), 0), (w, h), interpolation=cv2.INTER_LINEAR) * strength
    img[:] = img * (1 - m[:, :, None])


def _flat_device(bw, bh, radius, body, screen_rect, screen_radius):
    """Device drawn face-on: body colour, black glass screen. Returns (BGR float, alpha)."""
    alpha = rounded_rect_alpha(bw, bh, radius)
    rgb = np.ones((bh, bw, 3), np.float32) * np.array(body, np.float32)
    sx, sy, sw, sh = screen_rect
    glass = rounded_rect_alpha(sw, sh, screen_radius)
    region = rgb[sy : sy + sh, sx : sx + sw]
    region[:] = region * (1 - glass[:, :, None]) + np.array([12, 12, 14], np.float32) * glass[:, :, None]
    return rgb, alpha


def _place(img, flat_rgb, flat_alpha, quad):
    h, w = img.shape[:2]
    fh, fw = flat_alpha.shape
    src = np.array([[0, 0], [fw, 0], [fw, fh], [0, fh]], np.float32)
    H = cv2.getPerspectiveTransform(src, np.array(quad, np.float32))
    rgb = cv2.warpPerspective(flat_rgb, H, (w, h), flags=cv2.INTER_LINEAR)
    a = cv2.warpPerspective(flat_alpha, H, (w, h), flags=cv2.INTER_LINEAR)
    _blend(img, rgb, a)
    return H


def _map(H, pts):
    p = cv2.perspectiveTransform(np.array([pts], np.float32), H)[0]
    return [[round(float(x), 2), round(float(y), 2)] for x, y in p]


def device(img, kind, quad, body=(40, 40, 44)):
    """Draws a phone/tablet/monitor/laptop-lid onto the quad; returns the screen corners in photo pixels."""
    specs = {
        "phone": (1000, 2060, 150, (50, 60, 900, 1940), 110),
        "tablet": (1600, 2200, 110, (70, 70, 1460, 2060), 40),
        "monitor": (2400, 1460, 30, (40, 40, 2320, 1340), 6),
        "laptop": (2400, 1560, 40, (80, 70, 2240, 1400), 8),
    }
    bw, bh, r, rect, sr = specs[kind]
    rgb, a = _flat_device(bw, bh, r, body, rect, sr)
    _shadow(img, quad, 121, 0.45, offset=(18, 30))
    H = _place(img, rgb, a, quad)
    sx, sy, sw, sh = rect
    tl, tr, br, bl = _map(H, [[sx, sy], [sx + sw, sy], [sx + sw, sy + sh], [sx, sy + sh]])
    scale = np.linalg.norm(np.array(tr) - np.array(tl)) / sw
    return {"corners": {"tl": tl, "tr": tr, "br": br, "bl": bl}, "cornerRadius": round(float(sr * scale), 1)}


def laptop_base(img, lid_quad, depth=420, colour=(175, 178, 184)):
    bl, br = np.array(lid_quad[3], np.float32), np.array(lid_quad[2], np.float32)
    spread = (br - bl) * 0.06
    quad = [bl - spread * 0.2, br + spread * 0.2, br + spread + [0, depth], bl - spread + [0, depth]]
    _shadow(img, quad, 151, 0.5, offset=(0, 40))
    cv2.fillConvexPoly(img, np.array(quad, np.int32), colour, lineType=cv2.LINE_AA)
    kb = [bl + (br - bl) * 0.12 + [0, depth * 0.18], br - (br - bl) * 0.12 + [0, depth * 0.18], br - (br - bl) * 0.08 + [0, depth * 0.62], bl + (br - bl) * 0.08 + [0, depth * 0.62]]
    cv2.fillConvexPoly(img, np.array(kb, np.int32), (120, 122, 128), lineType=cv2.LINE_AA)


SCENES = []


def scene(**meta):
    def register(fn):
        SCENES.append((fn, meta))
        return fn

    return register


@scene(slug="desk-monitor", title="Monitor on a desk", device_type="desktop", scene="desk", tone="light")
def _s1():
    img = _bg(3600, 2400, (235, 232, 226), (210, 206, 200), seed=1)
    _desk(img, 1850, (150, 180, 205), seed=1)
    cv2.rectangle(img, (1710, 1500), (1890, 1900), (60, 60, 64), -1)
    cv2.ellipse(img, (1800, 1905), (330, 45), 0, 0, 360, (55, 55, 58), -1, cv2.LINE_AA)
    s = device(img, "monitor", [[700, 360], [2900, 330], [2900, 1690], [700, 1680]])
    return img, [dict(screenId="s1", device="desktop", **s)]


@scene(slug="laptop-left", title="Laptop, angled left", device_type="laptop", scene="desk", tone="warm")
def _s2():
    img = _bg(3600, 2400, (200, 220, 240), (170, 195, 225), seed=2)
    _desk(img, 1600, (95, 140, 190), seed=2)
    lid = [[800, 420], [2600, 560], [2580, 1640], [820, 1700]]
    s = device(img, "laptop", lid, body=(170, 172, 178))
    laptop_base(img, lid)
    return img, [dict(screenId="s1", device="desktop", **s)]


@scene(slug="laptop-right", title="Laptop, angled right", device_type="laptop", scene="studio", tone="cool")
def _s3():
    img = _bg(3600, 2400, (245, 240, 236), (225, 218, 214), seed=3)
    lid = [[950, 560], [2780, 400], [2760, 1700], [980, 1640]]
    s = device(img, "laptop", lid, body=(60, 60, 64))
    laptop_base(img, lid, colour=(70, 70, 74))
    return img, [dict(screenId="s1", device="desktop", **s)]


@scene(slug="tablet-studio", title="Tablet, studio", device_type="tablet", scene="studio", tone="light")
def _s4():
    img = _bg(2400, 3200, (238, 236, 240), (215, 212, 218), seed=4)
    s = device(img, "tablet", [[520, 520], [1880, 560], [1860, 2620], [500, 2590]])
    return img, [dict(screenId="s1", device="tablet", **s)]


@scene(slug="tablet-desk-warm", title="Tablet on a warm desk", device_type="tablet", scene="desk", tone="warm")
def _s5():
    img = _bg(2400, 3200, (180, 200, 225), (150, 175, 210), seed=5)
    _desk(img, 900, (80, 120, 170), seed=5)
    s = device(img, "tablet", [[600, 700], [1820, 640], [1940, 2560], [520, 2620]], body=(200, 202, 206))
    return img, [dict(screenId="s1", device="tablet", **s)]


@scene(slug="phone-front", title="Phone, front", device_type="mobile", scene="studio", tone="light")
def _s6():
    img = _bg(2400, 3200, (232, 236, 240), (205, 212, 220), seed=6)
    s = device(img, "phone", [[780, 620], [1620, 620], [1620, 2350], [780, 2350]])
    return img, [dict(screenId="s1", device="mobile", **s)]


@scene(slug="phone-tilted-outdoor", title="Phone, tilted outdoors", device_type="mobile", scene="outdoor", tone="cool")
def _s7():
    img = _bg(2400, 3200, (240, 210, 170), (120, 160, 110), noise=10, seed=7)
    s = device(img, "phone", [[820, 560], [1700, 700], [1560, 2480], [640, 2330]], body=(30, 30, 34))
    return img, [dict(screenId="s1", device="mobile", **s)]


@scene(slug="two-phones", title="Two phones", device_type="multi", scene="studio", tone="light")
def _s8():
    img = _bg(3600, 2400, (240, 236, 232), (220, 214, 208), seed=8)
    a = device(img, "phone", [[980, 360], [1690, 420], [1600, 1880], [880, 1820]])
    b = device(img, "phone", [[1950, 420], [2660, 360], [2760, 1820], [2040, 1880]], body=(200, 200, 205))
    return img, [dict(screenId="s1", device="mobile", zIndex=1, **a), dict(screenId="s2", device="mobile", zIndex=2, **b)]


@scene(slug="laptop-and-phone", title="Laptop and phone", device_type="multi", scene="desk", tone="light")
def _s9():
    img = _bg(3600, 2400, (236, 234, 230), (214, 210, 204), seed=9)
    _desk(img, 1650, (160, 185, 210), seed=9)
    lid = [[520, 380], [2440, 380], [2440, 1560], [520, 1560]]
    a = device(img, "laptop", lid, body=(175, 176, 180))
    laptop_base(img, lid, depth=360)
    b = device(img, "phone", [[2560, 900], [3060, 900], [3060, 1930], [2560, 1930]])
    return img, [dict(screenId="s1", device="desktop", zIndex=1, **a), dict(screenId="s2", device="mobile", zIndex=2, **b)]


@scene(slug="full-set", title="Monitor, tablet and phone", device_type="multi", scene="desk", tone="light")
def _s10():
    img = _bg(4000, 2600, (238, 236, 232), (216, 212, 206), seed=10)
    _desk(img, 1900, (150, 175, 200), seed=10)
    cv2.rectangle(img, (1660, 1500), (1840, 1950), (60, 60, 64), -1)
    a = device(img, "monitor", [[620, 300], [2880, 300], [2880, 1675], [620, 1675]])
    b = device(img, "tablet", [[2700, 900], [3420, 900], [3420, 1890], [2700, 1890]])
    c = device(img, "phone", [[3500, 1300], [3860, 1300], [3860, 2040], [3500, 2040]])
    return img, [
        dict(screenId="s1", device="desktop", zIndex=1, **a),
        dict(screenId="s2", device="tablet", zIndex=2, **b),
        dict(screenId="s3", device="mobile", zIndex=3, **c),
    ]


@scene(slug="phone-dark-studio", title="Phone, dark studio", device_type="mobile", scene="studio", tone="dark")
def _s11():
    img = _bg(2400, 3200, (40, 38, 36), (18, 17, 16), seed=11)
    s = device(img, "phone", [[740, 560], [1660, 610], [1620, 2500], [700, 2450]], body=(90, 90, 96))
    return img, [dict(screenId="s1", device="mobile", **s)]


@scene(slug="monitor-dark", title="Monitor, dark room", device_type="desktop", scene="studio", tone="dark")
def _s12():
    img = _bg(3600, 2400, (46, 44, 52), (22, 20, 26), seed=12)
    _desk(img, 1850, (40, 45, 52), seed=12)
    cv2.rectangle(img, (1720, 1500), (1880, 1900), (30, 30, 34), -1)
    s = device(img, "monitor", [[620, 300], [2980, 360], [2980, 1690], [620, 1720]], body=(20, 20, 22))
    return img, [dict(screenId="s1", device="desktop", **s)]


def generate(out_dir: str) -> list[dict]:
    os.makedirs(out_dir, exist_ok=True)
    manifest = []
    for fn, meta in SCENES:
        img, screens = fn()
        photo = np.clip(np.rint(img), 0, 255).astype(np.uint8)
        path = os.path.join(out_dir, f"{meta['slug']}.jpg")
        cv2.imwrite(path, photo, [cv2.IMWRITE_JPEG_QUALITY, 92])
        manifest.append({**meta, "file": path, "width": photo.shape[1], "height": photo.shape[0], "screens": screens})
    with open(os.path.join(out_dir, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    return manifest


if __name__ == "__main__":
    print(json.dumps(generate(sys.argv[1] if len(sys.argv) > 1 else "seed-mockups"), indent=1)[:400])
