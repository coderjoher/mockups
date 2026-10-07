"""[EX-5] scrolling MP4 of a full-page capture inside a frame, 10 to 20 seconds."""
import json
import os
import subprocess
import tempfile

import cv2
import numpy as np

from mockup_render.video import FPS, frames_for, offsets, plan, scrolling_video


def tall_capture(h=9000, w=1440):
    img = np.zeros((h, w, 3), np.uint8)
    for i, y in enumerate(range(0, h, 300)):
        img[y : y + 300] = ((i * 37) % 255, (i * 91) % 255, (i * 53 + 60) % 255)
    return img


def probe(data: bytes) -> dict:
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
        f.write(data)
        path = f.name
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,codec_name,pix_fmt,nb_frames:format=duration", "-of", "json", path],
            capture_output=True, text=True, check=True,
        ).stdout
        frames = []
        cap = cv2.VideoCapture(path)
        ok, first = cap.read()
        last = first
        while ok:
            last = frames[-1] if frames else first
            ok, fr = cap.read()
            if ok:
                frames.append(fr)
        cap.release()
        return {"meta": json.loads(out), "first": first, "last": frames[-1] if frames else first}
    finally:
        os.remove(path)


def test_ex5_duration_size_and_codec():
    data = scrolling_video(tall_capture(), "slide")
    info = probe(data)
    stream = info["meta"]["streams"][0]
    assert (stream["width"], stream["height"]) == (1920, 1080)
    assert stream["codec_name"] == "h264" and stream["pix_fmt"] == "yuv420p"
    assert 10.0 <= float(info["meta"]["format"]["duration"]) <= 20.1


def test_ex5_first_frame_shows_the_top_and_last_frame_the_bottom():
    cap = tall_capture()
    frames = list(frames_for(cap, "slide"))
    info = probe(scrolling_video(cap, "slide"))
    # Compare decoded video frames (lossy) with the frames we fed in.
    assert np.abs(info["first"].astype(int) - frames[0].astype(int)).mean() < 6
    assert np.abs(info["last"].astype(int) - frames[-1].astype(int)).mean() < 6
    assert not np.array_equal(frames[0], frames[-1])


def test_ex5_short_pages_still_last_ten_seconds_and_long_pages_cap_at_twenty():
    assert plan(1200, 1000)[0] == 10.0
    assert plan(100_000, 1000)[0] == 20.0
    offs = offsets(5000, 1000, 300)
    assert offs[0] == 0 and offs[FPS - 1] == 0  # holds at the top
    assert offs[-1] == 4000 and offs[-FPS] == 4000  # holds at the bottom
    assert all(b >= a for a, b in zip(offs, offs[1:]))
