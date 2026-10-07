import { PNG } from 'pngjs';

/**
 * Chromium sometimes rounds a fractional device-pixel edge (e.g. 844 x 3 -> 2531). Make the image the exact
 * output size by repeating the last row/column, or trimming, so captures always match the PRD sizes.
 */
export function fitExact(buf: Buffer, width: number, height: number): Buffer {
  const src = PNG.sync.read(buf);
  if (src.width === width && src.height === height) return buf;
  if (Math.abs(src.width - width) > 4 || Math.abs(src.height - height) > 4) return buf;
  const out = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    const sy = Math.min(y, src.height - 1);
    for (let x = 0; x < width; x++) {
      const sx = Math.min(x, src.width - 1);
      src.data.copy(out.data, (y * width + x) * 4, (sy * src.width + sx) * 4, (sy * src.width + sx) * 4 + 4);
    }
  }
  return PNG.sync.write(out);
}
