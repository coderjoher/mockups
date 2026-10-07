"""Phase 9: [EX-2] size presets, [CX-4] headline and logo, [CX-2] backgrounds on presets."""
import cv2
import numpy as np
import pytest

from mockup_render.layouts import grid_collage, parse_colour
from mockup_render.presets import PRESETS, add_headline, fit_preset

from .test_render import pattern


@pytest.mark.parametrize("preset,size", [("ig_post", (1080, 1350)), ("ig_story", (1080, 1920)), ("linkedin", (1200, 627)), ("slide", (1920, 1080)), ("4k", (3840, 2160))])
def test_ex2_fixed_presets_have_exact_sizes(preset, size):
    out = fit_preset(pattern(3200, 2000), preset)
    assert (out.shape[1], out.shape[0]) == size


def test_ex2_behance_is_1400_wide_and_keeps_the_aspect():
    out = fit_preset(pattern(3200, 2000), "behance")
    assert out.shape[1] == 1400 and out.shape[0] == 875
    assert set(PRESETS) == {"ig_post", "ig_story", "linkedin", "behance", "slide", "4k"}


def test_ex2_cx2_presets_contain_the_image_on_the_chosen_background():
    out = fit_preset(np.full((2000, 3200, 3), 200, np.uint8), "ig_story", bg={"type": "solid", "colour": "#0f766e"})
    assert tuple(out[5, 5]) == parse_colour("#0f766e")  # letterbox
    assert tuple(out[960, 540]) == (200, 200, 200)  # image, never cropped
    with pytest.raises(ValueError):
        fit_preset(out, "tiktok")


def _ink_columns(band: np.ndarray) -> np.ndarray:
    dark = (band.mean(axis=2) < 100).sum(axis=0)
    return np.where(dark > 0)[0]


def test_cx4_headline_band_left_for_latin_right_for_arabic():
    base = grid_collage([pattern(1440, 900, i) for i in range(2)], width=1600)
    en = add_headline(base, "Our new website")
    assert en.shape[0] > base.shape[0] and en.shape[1] == base.shape[1]
    band = en[: en.shape[0] - base.shape[0]]
    cols = _ink_columns(band)
    assert cols.mean() < base.shape[1] / 2
    ar = add_headline(base, "موقعنا الجديد")
    cols = _ink_columns(ar[: ar.shape[0] - base.shape[0]])
    assert cols.mean() > base.shape[1] / 2
    # Shaped Arabic: joined letters give fewer separate glyph runs than isolated forms would.
    assert len(cols) > 50


def test_cx4_logo_is_placed_in_the_band():
    base = grid_collage([pattern(1440, 900)], width=1600)
    logo = np.zeros((60, 160, 4), np.uint8)
    logo[:] = (11, 158, 245, 255)  # amber, BGRA
    out = add_headline(base, "Launch", logo=logo)
    band = out[: out.shape[0] - base.shape[0]]
    amber = np.all(np.abs(band.astype(int) - (11, 158, 245)) < 6, axis=2)
    assert amber.sum() > 1000
    assert np.where(amber)[1].mean() < 400  # leading edge for LTR
    assert np.array_equal(add_headline(base, None), base)
