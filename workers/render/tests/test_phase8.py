"""Phase 8 render features: [CR-3] scroll offset, [CP-5] overlay, [CP-6] light map, [CR-5] layouts, [CR-4] batch determinism."""
import hashlib
import os

import cv2
import numpy as np
import pytest

from mockup_render.jobs import encode
from mockup_render.layouts import background, grid_collage, parse_colour, tall_frame
from mockup_render.render import Assignment, Scene, Screen, compose

from .test_render import GOLDEN, QUAD, pattern, photo, ssim


def tall_capture():
    """A full-page capture whose bands change colour every 400 px."""
    img = np.zeros((6000, 1440, 3), np.uint8)
    for i, y in enumerate(range(0, 6000, 400)):
        img[y : y + 400] = ((i * 40) % 255, (i * 90) % 255, (i * 150) % 255)
    return img


def test_cr3_scroll_offset_shows_a_different_part_of_a_full_page_capture():
    scene = Scene(photo(1600, 1000), [Screen("s1", "desktop", {"tl": [200, 200], "tr": [1200, 200], "br": [1200, 825], "bl": [200, 825]})])
    top = compose(scene, {"s1": Assignment(tall_capture(), 0)})
    lower = compose(scene, {"s1": Assignment(tall_capture(), 800)})
    centre = (700, 500)
    assert tuple(top[centre[1], centre[0]]) != tuple(lower[centre[1], centre[0]])
    # The offset maps to the expected band: 800 px down shows band 2 at the top of the screen.
    assert tuple(lower[210, 700]) == ((2 * 40) % 255, (2 * 90) % 255, (2 * 150) % 255)


def test_cp5_overlay_is_drawn_above_the_screen():
    overlay = np.zeros((2000, 3200, 4), np.uint8)
    cv2.rectangle(overlay, (1400, 900), (1600, 1100), (255, 255, 255, 140), -1)  # a soft glare
    scene = Scene(photo(), [Screen("s1", "desktop", QUAD)], overlay=overlay)
    out = compose(scene, {"s1": Assignment(pattern(2880, 1800))})
    plain = compose(Scene(photo(), [Screen("s1", "desktop", QUAD)]), {"s1": Assignment(pattern(2880, 1800))})
    assert out[1000, 1500].mean() > plain[1000, 1500].mean()
    assert np.array_equal(out[100, 100], plain[100, 100])


def test_cp6_light_map_multiplies_only_the_screen():
    light = np.full((2000, 3200, 3), 255, np.uint8)
    light[:, 1600:] = 128  # right half in shadow
    scene = Scene(photo(), [Screen("s1", "desktop", QUAD)], light_map=light)
    out = compose(scene, {"s1": Assignment(np.full((1800, 2880, 3), 240, np.uint8))})
    assert out[1000, 1000].mean() > 230
    assert 110 < out[1000, 2000].mean() < 130
    assert np.array_equal(out[50, 3000], photo()[50, 3000])  # photo itself untouched


@pytest.mark.parametrize("name", ["overlay_lightmap", "grid", "tall"])
def test_v_phase8_goldens(name):
    if name == "overlay_lightmap":
        overlay = np.zeros((2000, 3200, 4), np.uint8)
        cv2.circle(overlay, (2200, 700), 300, (255, 255, 255, 90), -1)
        light = np.tile(np.linspace(255, 150, 3200, dtype=np.float32)[None, :, None], (2000, 1, 3)).astype(np.uint8)
        out = compose(Scene(photo(), [Screen("s1", "desktop", QUAD, 12)], overlay=overlay, light_map=light), {"s1": Assignment(pattern(2880, 1800, 4))})
    elif name == "grid":
        out = grid_collage([pattern(2880, 1800, i) for i in range(5)], bg={"type": "gradient", "from": "#eef2ff", "to": "#c7d2fe", "angle": 135})
    else:
        out = tall_frame(tall_capture(), bg={"type": "solid", "colour": "#0f172a"})
    path = os.path.join(GOLDEN, f"{name}.png")
    if os.environ.get("UPDATE_GOLDEN") or not os.path.exists(path):
        cv2.imwrite(path, out)
        if not os.environ.get("UPDATE_GOLDEN"):
            pytest.fail(f"golden image {name}.png was missing and has been written; review and commit it")
    golden = cv2.imread(path)
    assert golden.shape == out.shape
    assert ssim(out, golden) >= 0.99


def test_cr5_layout_shapes_and_backgrounds():
    grid = grid_collage([pattern(2880, 1800, i) for i in range(4)], width=2400, padding=80)
    assert grid.shape[1] == 2400
    assert tuple(grid[10, 10]) == parse_colour("#f4f4f2")
    tall = tall_frame(tall_capture(), width=1600, max_height=5000)
    assert tall.shape[1] == 1600 and tall.shape[0] <= 5000
    g = background(100, 100, {"type": "gradient", "from": "#000000", "to": "#ffffff", "angle": 0})
    assert g[50, 0].mean() < 5 and g[50, 99].mean() > 250
    with pytest.raises(ValueError):
        parse_colour("red")
    with pytest.raises(ValueError):
        grid_collage([])


def test_cr4_batch_renders_stay_deterministic():
    scene = Scene(photo(), [Screen("s1", "desktop", QUAD)])
    hashes = [hashlib.sha256(encode(compose(scene, {"s1": Assignment(pattern(2880, 1800, i))}), "png")).hexdigest() for i in range(5)]
    again = [hashlib.sha256(encode(compose(scene, {"s1": Assignment(pattern(2880, 1800, i))}), "png")).hexdigest() for i in range(5)]
    assert hashes == again and len(set(hashes)) == 5
