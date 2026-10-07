"""[EX-1] export formats at native resolution; JPG at 90 % quality."""
import io

import cv2
import numpy as np
from PIL import Image

from mockup_render.jobs import encode
from mockup_render.render import Assignment, Scene, Screen, compose

from .test_render import QUAD, pattern, photo


def _render():
    return compose(Scene(photo(3200, 2000), [Screen("s1", "desktop", QUAD, 12)]), {"s1": Assignment(pattern(2880, 1800))})


def test_ex1_png_webp_jpg_decode_at_native_size():
    out = _render()
    for fmt in ("png", "webp", "jpg"):
        img = Image.open(io.BytesIO(encode(out, fmt)))
        assert img.size == (3200, 2000), fmt
        assert img.format == {"png": "PNG", "webp": "WEBP", "jpg": "JPEG"}[fmt]
    # PNG and WebP are lossless.
    for fmt in ("png", "webp"):
        back = cv2.imdecode(np.frombuffer(encode(out, fmt), np.uint8), cv2.IMREAD_COLOR)
        assert np.array_equal(back, out), fmt


def test_ex1_jpg_quality_is_90():
    out = _render()
    ours = Image.open(io.BytesIO(encode(out, "jpg", 90)))
    buf = io.BytesIO()
    Image.fromarray(cv2.cvtColor(out, cv2.COLOR_BGR2RGB)).save(buf, "JPEG", quality=90)
    reference = Image.open(io.BytesIO(buf.getvalue()))
    # Same IJG quantisation tables as a quality-90 encode.
    assert ours.quantization[0] == reference.quantization[0]
    assert ours.quantization[1] == reference.quantization[1]
    buf = io.BytesIO()
    Image.fromarray(out).save(buf, "JPEG", quality=80)
    assert Image.open(io.BytesIO(buf.getvalue())).quantization[0] != ours.quantization[0]
