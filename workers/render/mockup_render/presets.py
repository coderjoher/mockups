"""EX-2 social and slide size presets, and CX-4 headline + client logo on presentation layouts."""
from __future__ import annotations

import os

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .layouts import background

PRESETS: dict[str, tuple[int, int | None]] = {
    "ig_post": (1080, 1350),
    "ig_story": (1080, 1920),
    "linkedin": (1200, 627),
    "behance": (1400, None),  # 1400 wide, height follows the image
    "slide": (1920, 1080),
    "4k": (3840, 2160),
}

FONT_DIR = os.environ.get("FONT_DIR", "/usr/local/share/fonts/mockups")


def fit_preset(img: np.ndarray, preset: str, bg: dict | None = None, margin: float = 0.06) -> np.ndarray:
    """Places the render inside the preset canvas (contained, centred, never cropped or stretched)."""
    if preset not in PRESETS:
        raise ValueError(f"unknown preset {preset}")
    w, h = PRESETS[preset]
    ih, iw = img.shape[:2]
    if h is None:
        return cv2.resize(img, (w, round(ih * w / iw)), interpolation=cv2.INTER_AREA if iw > w else cv2.INTER_CUBIC)
    inner_w, inner_h = w * (1 - 2 * margin), h * (1 - 2 * margin)
    s = min(inner_w / iw, inner_h / ih)
    nw, nh = max(1, round(iw * s)), max(1, round(ih * s))
    scaled = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_CUBIC)
    canvas = np.clip(np.rint(background(w, h, bg)), 0, 255).astype(np.uint8)
    x, y = (w - nw) // 2, (h - nh) // 2
    canvas[y : y + nh, x : x + nw] = scaled[:, :, :3]
    return canvas


def _font(size: int) -> ImageFont.FreeTypeFont:
    for name in ("IBMPlexSansArabic-Bold.ttf", "Tajawal-Bold.ttf", "NotoSansArabic[wdth,wght].ttf"):
        path = os.path.join(FONT_DIR, name)
        if os.path.exists(path):
            return ImageFont.truetype(path, size, layout_engine=ImageFont.Layout.RAQM)
    return ImageFont.load_default(size)


def add_headline(img: np.ndarray, headline: str | None, logo: np.ndarray | None = None, colour=(20, 20, 20), rtl: bool | None = None) -> np.ndarray:
    """CX-4: a headline band above the layout, with the client logo at the leading edge. Arabic is shaped and right-aligned."""
    if not headline and logo is None:
        return img
    h, w = img.shape[:2]
    band = max(120, w // 12)
    size = int(band * 0.42)
    canvas = Image.new("RGB", (w, h + band), tuple(int(c) for c in img[2, 2][::-1]))
    canvas.paste(Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB)), (0, band))
    draw = ImageDraw.Draw(canvas)
    if rtl is None:
        rtl = bool(headline) and any("؀" <= ch <= "ۿ" for ch in headline)
    pad = max(40, w // 30)
    logo_w = 0
    if logo is not None:
        lh = int(band * 0.6)
        lw = max(1, round(logo.shape[1] * lh / logo.shape[0]))
        lg = cv2.resize(logo, (lw, lh), interpolation=cv2.INTER_AREA)
        lg_rgba = Image.fromarray(cv2.cvtColor(lg, cv2.COLOR_BGRA2RGBA if lg.shape[2] == 4 else cv2.COLOR_BGR2RGBA))
        lx = w - pad - lw if rtl else pad
        canvas.paste(lg_rgba, (lx, (band - lh) // 2), lg_rgba)
        logo_w = lw + pad // 2
    if headline:
        font = _font(size)
        direction = "rtl" if rtl else "ltr"
        box = draw.textbbox((0, 0), headline, font=font, direction=direction)
        tw = box[2] - box[0]
        y = (band - (box[3] - box[1])) // 2 - box[1]
        x = w - pad - logo_w - tw if rtl else pad + logo_w
        draw.text((x, y), headline, font=font, fill=tuple(int(c) for c in colour[::-1]), direction=direction)
    return cv2.cvtColor(np.array(canvas), cv2.COLOR_RGB2BGR)
