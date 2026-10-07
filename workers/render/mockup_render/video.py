"""EX-5: a scrolling MP4 of a full-page capture inside a browser frame (10 to 20 seconds)."""
from __future__ import annotations

import os
import subprocess
import tempfile

import cv2
import numpy as np

from .layouts import _browser_frame, background
from .presets import PRESETS

FPS = 30
MIN_S, MAX_S = 10.0, 20.0
SPEED_PX_PER_S = 400  # in capture pixels


def plan(capture_h: int, window_h: int) -> tuple[float, int]:
    """(duration seconds, frames): one second still at each end, scroll speed clamped into 10-20 s."""
    travel = max(0, capture_h - window_h)
    duration = min(MAX_S, max(MIN_S, travel / SPEED_PX_PER_S + 2))
    return duration, int(round(duration * FPS))


def offsets(capture_h: int, window_h: int, frames: int) -> list[int]:
    """Ease-in-out scroll positions, holding one second at the top and at the bottom."""
    travel = max(0, capture_h - window_h)
    hold = FPS
    moving = max(1, frames - 2 * hold)
    out = []
    for i in range(frames):
        t = min(1.0, max(0.0, (i - hold) / moving))
        eased = t * t * (3 - 2 * t)
        out.append(int(round(eased * travel)))
    return out


def frames_for(capture: np.ndarray, preset: str = "slide", bg: dict | None = None):
    """Yields BGR frames: the preset canvas with a browser window scrolling through the capture."""
    w, h = PRESETS[preset]
    h = h or round(w * 9 / 16)
    margin = int(min(w, h) * 0.06)
    win_w = w - 2 * margin
    scale = win_w / capture.shape[1]
    scaled = cv2.resize(capture[:, :, :3], (win_w, max(1, round(capture.shape[0] * scale))), interpolation=cv2.INTER_AREA)
    bar = _browser_frame(scaled[:2], win_w)[: -2]  # just the browser bar
    win_h = h - 2 * margin - bar.shape[0]
    canvas = np.clip(np.rint(background(w, h, bg)), 0, 255).astype(np.uint8)
    canvas[margin : margin + bar.shape[0], margin : margin + win_w] = bar
    duration, n = plan(scaled.shape[0], win_h)
    for off in offsets(scaled.shape[0], win_h, n):
        frame = canvas.copy()
        view = scaled[off : off + win_h]
        frame[margin + bar.shape[0] : margin + bar.shape[0] + view.shape[0], margin : margin + win_w] = view
        yield frame


def encode_mp4(frames, width: int, height: int) -> bytes:
    """H.264 / yuv420p MP4 through ffmpeg, single-threaded so the same input gives the same file."""
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, "out.mp4")
        cmd = [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{width}x{height}", "-r", str(FPS), "-i", "-",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-threads", "1",
            "-movflags", "+faststart", "-bitexact", "-map_metadata", "-1", out,
        ]
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
        assert proc.stdin is not None
        for f in frames:
            proc.stdin.write(np.ascontiguousarray(f).tobytes())
        proc.stdin.close()
        if proc.wait() != 0:
            raise RuntimeError("ffmpeg failed to encode the video")
        with open(out, "rb") as fh:
            return fh.read()


def scrolling_video(capture: np.ndarray, preset: str = "slide", bg: dict | None = None) -> bytes:
    w, h = PRESETS[preset]
    h = h or round(w * 9 / 16)
    return encode_mp4(frames_for(capture, preset, bg), w, h)
