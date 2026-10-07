import { PNG } from 'pngjs';

export function decode(buf: Buffer): PNG {
  return PNG.sync.read(buf);
}

/** Share of pixels within `tol` of the given colour, optionally inside a rectangle. */
export function colourShare(png: PNG, [r, g, b]: [number, number, number], tol = 12, rect?: { x: number; y: number; w: number; h: number }): number {
  const x0 = rect?.x ?? 0, y0 = rect?.y ?? 0, w = rect?.w ?? png.width, h = rect?.h ?? png.height;
  let hits = 0;
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * png.width + x) * 4;
      if (Math.abs(png.data[i] - r) <= tol && Math.abs(png.data[i + 1] - g) <= tol && Math.abs(png.data[i + 2] - b) <= tol) hits++;
    }
  }
  return hits / (w * h);
}
