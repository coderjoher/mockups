import { describe, expect, it } from 'vitest';
import { applyHomography, homography, matrix3d, type Pt } from '../lib/matrix3d';

/** Applies a CSS matrix3d string (transform-origin 0 0) to a point, like the browser does. */
function applyCss(css: string, [x, y]: Pt): Pt {
  const m = css.slice('matrix3d('.length, -1).split(',').map(Number);
  const X = m[0] * x + m[4] * y + m[12];
  const Y = m[1] * x + m[5] * y + m[13];
  const W = m[3] * x + m[7] * y + m[15];
  return [X / W, Y / W];
}

describe('[CP-3] live warped preview (matrix3d)', () => {
  const quad: [Pt, Pt, Pt, Pt] = [[1204, 388], [1712, 402], [1690, 1466], [1182, 1450]];

  it('maps the element corners onto the four screen corners within 0.5 px', () => {
    const css = matrix3d(390, 844, quad);
    const corners: Pt[] = [[0, 0], [390, 0], [390, 844], [0, 844]];
    corners.forEach((c, i) => {
      const [x, y] = applyCss(css, c);
      expect(Math.abs(x - quad[i][0])).toBeLessThan(0.5);
      expect(Math.abs(y - quad[i][1])).toBeLessThan(0.5);
    });
  });

  it('keeps straight lines straight (centre maps to the diagonals crossing)', () => {
    const H = homography([[0, 0], [1, 0], [1, 1], [0, 1]], quad);
    const [cx, cy] = applyHomography(H, [0.5, 0.5]);
    // Intersection of the quad diagonals.
    const [[x1, y1], , [x3, y3]] = quad;
    const [, [x2, y2], , [x4, y4]] = quad;
    const d = (x1 - x3) * (y2 - y4) - (y1 - y3) * (x2 - x4);
    const px = ((x1 * y3 - y1 * x3) * (x2 - x4) - (x1 - x3) * (x2 * y4 - y2 * x4)) / d;
    const py = ((x1 * y3 - y1 * x3) * (y2 - y4) - (y1 - y3) * (x2 * y4 - y2 * x4)) / d;
    expect(Math.abs(cx - px)).toBeLessThan(1e-6);
    expect(Math.abs(cy - py)).toBeLessThan(1e-6);
  });

  it('refuses a degenerate quad', () => {
    expect(() => matrix3d(10, 10, [[0, 0], [0, 0], [0, 0], [0, 0]])).toThrow('degenerate');
  });
});
