"""Phase 6 render engine: [R-1]..[R-6], [CR-1], [CR-6], [CR-7]."""
import hashlib
import os
import subprocess
import sys
import time

import cv2
import numpy as np
import pytest

from mockup_render.jobs import encode
from mockup_render.render import Assignment, Scene, Screen, compose, crop_to_aspect, homography, warp_screen

GOLDEN = os.path.join(os.path.dirname(__file__), "golden")


def pattern(w, h, seed=0):
    """Deterministic 'website' capture: coloured header, text-like bars, grid."""
    rng = np.random.default_rng(seed)
    img = np.full((h, w, 3), 245, np.uint8)
    img[: h // 10] = (180, 90, 30)
    for y in range(h // 8, h, max(8, h // 40)):
        x1 = int(w * (0.1 + 0.5 * rng.random()))
        cv2.rectangle(img, (w // 12, y), (x1, y + max(2, h // 120)), (60, 60, 60), -1)
    for x in range(0, w, max(10, w // 12)):
        cv2.line(img, (x, 0), (x, h), (220, 220, 220), 1)
    cv2.rectangle(img, (0, 0), (w - 1, h - 1), (0, 0, 255), max(1, w // 200))
    return img


def photo(w=3200, h=2000):
    y = np.linspace(0, 1, h, dtype=np.float32)[:, None, None]
    return np.clip((1 - y) * np.array([230, 220, 210]) + y * np.array([120, 110, 100]), 0, 255).astype(np.uint8) * np.ones((1, w, 1), np.uint8)


QUAD = {"tl": [700.0, 420.0], "tr": [2450.0, 520.0], "br": [2400.0, 1560.0], "bl": [760.0, 1640.0]}


# --- [R-2] crop -----------------------------------------------------------------------------------

def test_r2_crops_from_the_top_to_the_screen_aspect_without_stretching():
    cap = pattern(1170, 2532)
    out = crop_to_aspect(cap, 16 / 10)
    assert out.shape[1] == 1170 and abs(out.shape[1] / out.shape[0] - 1.6) < 0.01
    assert np.array_equal(out[0], cap[0])  # top kept
    shifted = crop_to_aspect(cap, 16 / 10, offset=500)
    assert np.array_equal(shifted[0], cap[500])
    clamped = crop_to_aspect(cap, 16 / 10, offset=99999)
    assert np.array_equal(clamped[-1], cap[-1])
    # A capture wider than the screen keeps its full height and is cropped evenly at the sides.
    wide = crop_to_aspect(pattern(2880, 1800), 9 / 19.5)
    assert wide.shape[0] == 1800 and abs(wide.shape[1] / 1800 - 9 / 19.5) < 0.01


# --- [R-3] homography ----------------------------------------------------------------------------

def test_r3_homography_maps_the_crop_rectangle_onto_the_corners():
    q = np.array([QUAD[k] for k in ("tl", "tr", "br", "bl")], np.float32)
    H = homography(1600, 1000, q)
    src = np.array([[[0, 0], [1600, 0], [1600, 1000], [0, 1000]]], np.float32)
    dst = cv2.perspectiveTransform(src, H)[0]
    assert np.abs(dst - q).max() < 0.5


# --- [R-1] device matching is done by the API (see apps/api/test/renders.test.ts) ----------------

# --- [R-4] [CR-1] edges ----------------------------------------------------------------------------

def test_r4_cr1_edges_are_antialiased_and_have_no_gaps():
    black = np.zeros((800, 1000, 3), np.uint8)
    white = np.full((600, 900, 3), 255, np.uint8)
    s = Screen("s1", "desktop", {"tl": [100.3, 100.6], "tr": [900.2, 140.4], "br": [880.7, 700.1], "bl": [120.4, 690.8]})
    out = compose(Scene(black, [s]), {"s1": Assignment(white)})
    gray = out[:, :, 0].astype(int)
    found_ramp = 0
    for y in range(200, 600, 25):
        row = gray[y]
        inside = np.where(row > 250)[0]
        left, right = inside.min(), inside.max()
        # Soft edge: at least one intermediate pixel at each side.
        if 0 < row[left - 1] < 250 or 0 < row[left - 2] < 250:
            found_ramp += 1
        # No gaps: everything between the edges is fully covered.
        assert (row[left : right + 1] > 250).all()
    assert found_ramp >= 12


def test_r4_rounded_corners_and_mask():
    black = np.zeros((600, 600, 3), np.uint8)
    white = np.full((400, 400, 3), 255, np.uint8)
    rect = {"tl": [100, 100], "tr": [500, 100], "br": [500, 500], "bl": [100, 500]}
    sharp = compose(Scene(black, [Screen("s", "mobile", rect)]), {"s": Assignment(white)})
    round_ = compose(Scene(black, [Screen("s", "mobile", rect, corner_radius=60)]), {"s": Assignment(white)})
    assert sharp[102, 102, 0] == 255 and round_[102, 102, 0] == 0  # corner cut away
    assert round_[300, 300, 0] == 255
    mask = np.full((100, 100), 255, np.uint8)
    mask[:20, 40:60] = 0  # a notch
    notched = compose(Scene(black, [Screen("s", "mobile", rect, mask=mask)]), {"s": Assignment(white)})
    assert notched[120, 300, 0] < 10 and notched[300, 300, 0] == 255


# --- [R-5] compositing order ----------------------------------------------------------------------

def test_r5_screens_are_layered_by_z_index_then_overlay_on_top():
    base = np.zeros((400, 400, 3), np.uint8)
    red = np.zeros((100, 100, 3), np.uint8); red[:] = (0, 0, 255)
    blue = np.zeros((100, 100, 3), np.uint8); blue[:] = (255, 0, 0)
    a = {"tl": [50, 50], "tr": [250, 50], "br": [250, 250], "bl": [50, 250]}
    b = {"tl": [150, 150], "tr": [350, 150], "br": [350, 350], "bl": [150, 350]}
    scene = Scene(base, [Screen("a", "desktop", a, z_index=1), Screen("b", "desktop", b, z_index=2)])
    out = compose(scene, {"a": Assignment(red), "b": Assignment(blue)})
    assert tuple(out[200, 200]) == (255, 0, 0)
    scene.screens[0].z_index = 3
    out = compose(scene, {"a": Assignment(red), "b": Assignment(blue)})
    assert tuple(out[200, 200]) == (0, 0, 255)
    overlay = np.zeros((400, 400, 4), np.uint8)
    overlay[190:210, 190:210] = (0, 255, 0, 255)
    scene.overlay = overlay
    out = compose(scene, {"a": Assignment(red), "b": Assignment(blue)})
    assert tuple(out[200, 200]) == (0, 255, 0)


# --- [R-6] resolution ---------------------------------------------------------------------------------

def test_r6_renders_at_the_photo_native_resolution():
    out = compose(Scene(photo(), [Screen("s1", "desktop", QUAD)]), {"s1": Assignment(pattern(2880, 1800))})
    assert out.shape == (2000, 3200, 3)
    preview = compose(Scene(photo(), [Screen("s1", "desktop", QUAD)]), {"s1": Assignment(pattern(2880, 1800))}, scale=0.5)
    assert preview.shape == (1000, 1600, 3)


# --- [V] golden images -----------------------------------------------------------------------------

def ssim(a: np.ndarray, b: np.ndarray) -> float:
    a = cv2.cvtColor(a, cv2.COLOR_BGR2GRAY).astype(np.float64)
    b = cv2.cvtColor(b, cv2.COLOR_BGR2GRAY).astype(np.float64)
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    blur = lambda x: cv2.GaussianBlur(x, (11, 11), 1.5)  # noqa: E731
    ma, mb = blur(a), blur(b)
    va, vb, cov = blur(a * a) - ma * ma, blur(b * b) - mb * mb, blur(a * b) - ma * mb
    m = ((2 * ma * mb + c1) * (2 * cov + c2)) / ((ma * ma + mb * mb + c1) * (va + vb + c2))
    return float(m.mean())


def golden_scenes():
    single = (Scene(photo(), [Screen("s1", "desktop", QUAD, corner_radius=12)]), {"s1": Assignment(pattern(2880, 1800, 1))})
    multi = (
        Scene(
            photo(),
            [
                Screen("s1", "desktop", {"tl": [300, 300], "tr": [2100, 360], "br": [2060, 1500], "bl": [330, 1480]}, 8, z_index=1),
                Screen("s2", "mobile", {"tl": [2000, 700], "tr": [2600, 760], "br": [2540, 1900], "bl": [1950, 1850]}, 60, z_index=2),
            ],
        ),
        {"s1": Assignment(pattern(2880, 1800, 2)), "s2": Assignment(pattern(1170, 2532, 3))},
    )
    return {"single": single, "multi": multi}


@pytest.mark.parametrize("name", ["single", "multi"])
def test_v_golden_images(name):
    scene, assignments = golden_scenes()[name]
    out = compose(scene, assignments)
    path = os.path.join(GOLDEN, f"{name}.png")
    if os.environ.get("UPDATE_GOLDEN") or not os.path.exists(path):
        os.makedirs(GOLDEN, exist_ok=True)
        cv2.imwrite(path, out)
        if not os.environ.get("UPDATE_GOLDEN"):
            pytest.fail(f"golden image {name}.png was missing and has been written; review and commit it")
    golden = cv2.imread(path)
    assert ssim(out, golden) >= 0.99


# --- [CR-7] determinism -----------------------------------------------------------------------------

def _hash_render():
    scene, assignments = golden_scenes()["multi"]
    return hashlib.sha256(encode(compose(scene, assignments), "png")).hexdigest()


def test_cr7_same_inputs_same_bytes_in_one_and_two_processes():
    first = _hash_render()
    assert _hash_render() == first
    code = "from tests.test_render import _hash_render; print(_hash_render())"
    root = os.path.dirname(os.path.dirname(__file__))
    other = subprocess.run([sys.executable, "-c", code], cwd=root, capture_output=True, text=True, check=True).stdout.strip()
    assert other == first
    for fmt in ("jpg", "webp"):
        out = compose(*golden_scenes()["single"])
        assert encode(out, fmt) == encode(out, fmt)


# --- [CR-6] [P] speed -----------------------------------------------------------------------------------

def test_cr6_preview_under_3s_and_final_under_10s_on_a_6000px_photo():
    big = photo(6000, 4000)
    screens = [
        Screen("s1", "desktop", {"tl": [600, 500], "tr": [4200, 600], "br": [4100, 2800], "bl": [650, 2900]}, 10, z_index=1),
        Screen("s2", "tablet", {"tl": [4000, 1200], "tr": [5200, 1250], "br": [5150, 3200], "bl": [3950, 3150]}, 40, z_index=2),
        Screen("s3", "mobile", {"tl": [5200, 2000], "tr": [5800, 2050], "br": [5750, 3500], "bl": [5150, 3450]}, 60, z_index=3),
    ]
    assignments = {"s1": Assignment(pattern(2880, 1800)), "s2": Assignment(pattern(1668, 2388)), "s3": Assignment(pattern(1170, 2532))}
    scene = Scene(big, screens)
    t = time.perf_counter()
    prev = compose(scene, assignments, scale=1600 / 6000)
    encode(prev, "jpg", 85)
    preview_s = time.perf_counter() - t
    t = time.perf_counter()
    encode(compose(scene, assignments), "png")
    final_s = time.perf_counter() - t
    print(f"preview {preview_s:.2f}s, final {final_s:.2f}s")
    assert preview_s < 3
    assert final_s < 10
