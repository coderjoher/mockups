// CP-2 / CP-4: validation of a stored screen definition (see the PRD example).
import { DEVICES, type Device } from './viewports';

export type Point = [number, number];
export interface Corners { tl: Point; tr: Point; br: Point; bl: Point }
export interface ScreenDef {
  screenId: string;
  device: Device;
  corners: Corners;
  cornerRadius?: number;
  maskUrl?: string | null;
  zIndex?: number;
}

export const CORNER_ORDER = ['tl', 'tr', 'br', 'bl'] as const;

export class ScreenError extends Error {
  statusCode = 422;
  code = 'bad_screen';
}

const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Signed area (shoelace). Positive = clockwise on screen (y grows downwards). */
export function quadArea(c: Corners): number {
  const p = CORNER_ORDER.map((k) => c[k]);
  let s = 0;
  for (let i = 0; i < 4; i++) s += p[i][0] * p[(i + 1) % 4][1] - p[(i + 1) % 4][0] * p[i][1];
  return s / 2;
}

/** Convex, non-self-intersecting and in TL, TR, BR, BL order. */
export function isConvexClockwise(c: Corners): boolean {
  const p = CORNER_ORDER.map((k) => c[k]);
  for (let i = 0; i < 4; i++) if (cross(p[i], p[(i + 1) % 4], p[(i + 2) % 4]) <= 0) return false;
  return true;
}

export function validateScreen(input: any, photo: { width: number; height: number }): ScreenDef {
  if (!input || typeof input !== 'object') throw new ScreenError('Screen must be an object');
  const screenId = String(input.screenId ?? '');
  if (!/^[a-z0-9_-]{1,20}$/i.test(screenId)) throw new ScreenError('Screen id must be 1-20 letters, digits, - or _');
  if (!DEVICES.includes(input.device)) throw new ScreenError(`Screen ${screenId}: device must be desktop, tablet or mobile`);
  const corners = input.corners;
  if (!corners || typeof corners !== 'object') throw new ScreenError(`Screen ${screenId}: four corners are required`);
  for (const k of CORNER_ORDER) {
    const pt = corners[k];
    if (!Array.isArray(pt) || pt.length !== 2 || !pt.every((n: unknown) => typeof n === 'number' && Number.isFinite(n))) {
      throw new ScreenError(`Screen ${screenId}: corner ${k} must be [x, y]`);
    }
    if (pt[0] < 0 || pt[1] < 0 || pt[0] > photo.width || pt[1] > photo.height) throw new ScreenError(`Screen ${screenId}: corner ${k} is outside the photo`);
  }
  const c = { tl: corners.tl, tr: corners.tr, br: corners.br, bl: corners.bl } as Corners;
  if (!isConvexClockwise(c)) throw new ScreenError(`Screen ${screenId}: corners must be clicked in order top-left, top-right, bottom-right, bottom-left`);
  if (quadArea(c) < 400) throw new ScreenError(`Screen ${screenId}: the screen area is too small`);
  const cornerRadius = Number(input.cornerRadius ?? 0);
  if (!Number.isFinite(cornerRadius) || cornerRadius < 0 || cornerRadius > 2000) throw new ScreenError(`Screen ${screenId}: corner radius must be 0-2000`);
  const zIndex = Number(input.zIndex ?? 1);
  if (!Number.isInteger(zIndex) || zIndex < 0 || zIndex > 100) throw new ScreenError(`Screen ${screenId}: z-index must be 0-100`);
  return { screenId, device: input.device, corners: c, cornerRadius, maskUrl: input.maskUrl ?? null, zIndex };
}

export function validateScreens(list: unknown, photo: { width: number; height: number }): ScreenDef[] {
  if (!Array.isArray(list)) throw new ScreenError('screens must be a list');
  if (list.length > 8) throw new ScreenError('A mockup can have at most 8 screens');
  const out = list.map((s) => validateScreen(s, photo));
  const ids = new Set(out.map((s) => s.screenId));
  if (ids.size !== out.length) throw new ScreenError('Screen ids must be unique');
  return out;
}
