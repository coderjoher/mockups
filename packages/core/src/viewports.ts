// Default capture viewports (PRD "Capture engine"), editable per project.
export type Device = 'desktop' | 'tablet' | 'mobile';
export const DEVICES: Device[] = ['desktop', 'tablet', 'mobile'];

export interface Viewport {
  width: number;
  height: number;
  scale: number;
}

export const DEFAULT_VIEWPORTS: Record<Device, Viewport> = {
  desktop: { width: 1440, height: 900, scale: 2 },
  tablet: { width: 834, height: 1194, scale: 2 },
  mobile: { width: 390, height: 844, scale: 3 },
};

export const FULL_PAGE_MAX_CSS_PX = 15_000; // CE-1

export function viewportsFor(overrides: Partial<Record<Device, Partial<Viewport>>> | null | undefined): Record<Device, Viewport> {
  const out = {} as Record<Device, Viewport>;
  for (const d of DEVICES) out[d] = { ...DEFAULT_VIEWPORTS[d], ...(overrides?.[d] ?? {}) };
  return out;
}

export function validateViewports(input: unknown): Partial<Record<Device, Viewport>> {
  if (!input || typeof input !== 'object') throw new Error('viewports must be an object');
  const out: Partial<Record<Device, Viewport>> = {};
  for (const [device, v] of Object.entries(input as Record<string, any>)) {
    if (!DEVICES.includes(device as Device)) throw new Error(`unknown device ${device}`);
    const width = Number(v?.width);
    const height = Number(v?.height);
    const scale = Number(v?.scale ?? DEFAULT_VIEWPORTS[device as Device].scale);
    if (!Number.isInteger(width) || width < 240 || width > 3840) throw new Error(`${device} width must be 240-3840`);
    if (!Number.isInteger(height) || height < 240 || height > 4000) throw new Error(`${device} height must be 240-4000`);
    if (![1, 2, 3].includes(scale)) throw new Error(`${device} scale must be 1, 2 or 3`);
    out[device as Device] = { width, height, scale };
  }
  return out;
}
