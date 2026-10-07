'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useT } from '@/lib/I18nProvider';
import { matrix3d, type Pt } from '@/lib/matrix3d';

type Corner = 'tl' | 'tr' | 'br' | 'bl';
const ORDER: Corner[] = ['tl', 'tr', 'br', 'bl'];
export interface ScreenDraft {
  screenId: string;
  device: 'desktop' | 'tablet' | 'mobile';
  corners: Partial<Record<Corner, Pt>>;
  cornerRadius: number;
  maskUrl: string | null;
  zIndex: number;
}

const TEST_SIZE: Record<string, [number, number]> = { desktop: [1440, 900], tablet: [834, 1194], mobile: [390, 844] };
const LOUPE = 160;
const ZOOM = 4;

/** CP-2/CP-3: click four corners in order, then drag handles with a magnifier and a live warped test image. */
export function CornerPicker({ mockup, onSaved }: { mockup: any; onSaved: (m: any) => void }) {
  const t = useT();
  const wrap = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const loupe = useRef<HTMLCanvasElement>(null);
  const [scale, setScale] = useState(1);
  const [screens, setScreens] = useState<ScreenDraft[]>(() =>
    (mockup.screens ?? []).map((s: any) => ({ screenId: s.screen_key, device: s.device, corners: s.corners, cornerRadius: s.corner_radius, maskUrl: s.mask_key, zIndex: s.z_index })),
  );
  const [active, setActive] = useState<string | null>(screens[0]?.screenId ?? null);
  const [drag, setDrag] = useState<{ screenId: string; corner: Corner } | null>(null);
  const [selected, setSelected] = useState<{ screenId: string; corner: Corner } | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const update = () => img.current && setScale(img.current.clientWidth / mockup.width);
    update();
    const ro = new ResizeObserver(update);
    if (img.current) ro.observe(img.current);
    return () => ro.disconnect();
  }, [mockup.width]);

  const current = screens.find((s) => s.screenId === active);
  const nextCorner = current ? ORDER.find((c) => !current.corners[c]) : undefined;

  function update(id: string, patch: Partial<ScreenDraft>) {
    setSaved(false);
    setScreens((all) => all.map((s) => (s.screenId === id ? { ...s, ...patch } : s)));
  }

  function toPhoto(e: { clientX: number; clientY: number }): Pt {
    const r = img.current!.getBoundingClientRect();
    const x = Math.min(mockup.width, Math.max(0, (e.clientX - r.left) / scale));
    const y = Math.min(mockup.height, Math.max(0, (e.clientY - r.top) / scale));
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
  }

  function addScreen() {
    const n = screens.length + 1;
    let id = `s${n}`;
    while (screens.some((s) => s.screenId === id)) id += '_';
    const device = (mockup.device_type === 'tablet' || mockup.device_type === 'mobile' ? mockup.device_type : mockup.device_type === 'multi' ? 'mobile' : 'desktop') as ScreenDraft['device'];
    setScreens((all) => [...all, { screenId: id, device, corners: {}, cornerRadius: 0, maskUrl: null, zIndex: n }]);
    setActive(id);
    setSaved(false);
  }

  function onImageClick(e: React.MouseEvent) {
    if (!current || !nextCorner || drag) return;
    update(current.screenId, { corners: { ...current.corners, [nextCorner]: toPhoto(e) } });
  }

  function drawLoupe(p: Pt) {
    const c = loupe.current;
    if (!c || !img.current) return;
    const ctx = c.getContext('2d')!;
    const src = LOUPE / ZOOM;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, LOUPE, LOUPE);
    ctx.drawImage(img.current, p[0] - src / 2, p[1] - src / 2, src, src, 0, 0, LOUPE, LOUPE);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(LOUPE / 2, 0);
    ctx.lineTo(LOUPE / 2, LOUPE);
    ctx.moveTo(0, LOUPE / 2);
    ctx.lineTo(LOUPE, LOUPE / 2);
    ctx.stroke();
  }

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const p = toPhoto(e);
      setScreens((all) => all.map((s) => (s.screenId === drag.screenId ? { ...s, corners: { ...s.corners, [drag.corner]: p } } : s)));
      setSaved(false);
      drawLoupe(p);
    };
    const up = () => setDrag(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  });

  // Arrow keys nudge the selected handle by one photo pixel (Shift: ten).
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!selected || !e.key.startsWith('Arrow') || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const d: Record<string, Pt> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      setScreens((all) =>
        all.map((s) => {
          if (s.screenId !== selected.screenId || !s.corners[selected.corner]) return s;
          const [x, y] = s.corners[selected.corner]!;
          const p: Pt = [Math.min(mockup.width, Math.max(0, x + d[e.key][0])), Math.min(mockup.height, Math.max(0, y + d[e.key][1]))];
          drawLoupe(p);
          return { ...s, corners: { ...s.corners, [selected.corner]: p } };
        }),
      );
      setSaved(false);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  async function save() {
    setError('');
    try {
      const body = screens.map((s) => ({ ...s, corners: s.corners }));
      const r = await api(`/admin/mockups/${mockup.id}/screens`, { method: 'PUT', json: { screens: body } });
      setSaved(true);
      onSaved(r.mockup);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function uploadMask(s: ScreenDraft, file: File) {
    const form = new FormData();
    form.append('file', file);
    try {
      const r = await api(`/admin/mockups/${mockup.id}/assets/mask-${s.screenId}`, { method: 'POST', body: form });
      update(s.screenId, { maskUrl: r.key });
    } catch (e: any) {
      setError(e.message);
    }
  }

  const complete = useMemo(() => screens.filter((s) => ORDER.every((c) => s.corners[c])), [screens]);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <div>
        {current && nextCorner && (
          <p className="mb-2 rounded bg-blue-50 p-2 text-sm text-blue-900" data-testid="picker-hint">
            {t('picker.click', { corner: t(`picker.corner_${nextCorner}`), screen: current.screenId })}
          </p>
        )}
        <div ref={wrap} className="relative select-none overflow-hidden rounded-lg border border-[var(--line)]" dir="ltr">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={img} src={mockup.photo_url} alt={mockup.title} className="block w-full" draggable={false} onClick={onImageClick} crossOrigin="anonymous" data-testid="picker-image" />
          {complete.map((s) => {
            const [w, h] = TEST_SIZE[s.device];
            const quad = ORDER.map((c) => [s.corners[c]![0] * scale, s.corners[c]![1] * scale]) as [Pt, Pt, Pt, Pt];
            let transform = '';
            try {
              transform = matrix3d(w, h, quad);
            } catch {
              return null;
            }
            return (
              <div
                key={`warp-${s.screenId}`}
                data-testid={`warp-${s.screenId}`}
                className="pointer-events-none absolute left-0 top-0 origin-top-left opacity-80"
                style={{ width: w, height: h, transform, zIndex: s.zIndex, borderRadius: s.cornerRadius * (w / Math.hypot(quad[1][0] - quad[0][0], quad[1][1] - quad[0][1])), background: 'repeating-linear-gradient(45deg,#2563eb 0 40px,#60a5fa 40px 80px)' }}
              >
                <div className="flex h-full items-center justify-center text-[64px] font-bold text-white">{s.screenId}</div>
              </div>
            );
          })}
          <svg className="pointer-events-none absolute inset-0 h-full w-full" style={{ zIndex: 50 }}>
            {screens.map((s) => {
              const pts = ORDER.filter((c) => s.corners[c]).map((c) => `${s.corners[c]![0] * scale},${s.corners[c]![1] * scale}`);
              return <polygon key={s.screenId} points={pts.join(' ')} fill="none" stroke={s.screenId === active ? '#ef4444' : '#f59e0b'} strokeWidth={1.5} />;
            })}
          </svg>
          {screens.flatMap((s) =>
            ORDER.filter((c) => s.corners[c]).map((c) => (
              <button
                key={`${s.screenId}-${c}`}
                data-testid={`handle-${s.screenId}-${c}`}
                aria-label={`${s.screenId} ${c}`}
                className={`absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-full border-2 ${selected?.screenId === s.screenId && selected.corner === c ? 'border-red-500 bg-white' : 'border-white bg-red-500'}`}
                style={{ left: s.corners[c]![0] * scale, top: s.corners[c]![1] * scale, zIndex: 60 }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setActive(s.screenId);
                  setSelected({ screenId: s.screenId, corner: c });
                  setDrag({ screenId: s.screenId, corner: c });
                  drawLoupe(s.corners[c]!);
                }}
              />
            )),
          )}
        </div>
      </div>
      <aside className="space-y-3">
        <canvas ref={loupe} width={LOUPE} height={LOUPE} className="rounded border border-[var(--line)] bg-gray-50" data-testid="loupe" aria-label={t('picker.loupe')} />
        {selected && current?.corners[selected.corner] && (
          <p className="muted text-xs" data-testid="handle-coords" dir="ltr">
            {selected.screenId} {selected.corner}: {current.corners[selected.corner]!.map((n) => n.toFixed(1)).join(', ')}
          </p>
        )}
        {screens.map((s) => (
          <fieldset key={s.screenId} className={`card space-y-2 p-3 ${s.screenId === active ? 'ring-2 ring-red-400' : ''}`} onClick={() => setActive(s.screenId)} data-testid={`screen-${s.screenId}`}>
            <legend className="px-1 text-sm font-semibold">{s.screenId}</legend>
            <label className="block text-sm">{t('picker.device')}
              <select className="input mt-1" value={s.device} onChange={(e) => update(s.screenId, { device: e.target.value as ScreenDraft['device'] })} data-testid={`device-${s.screenId}`}>
                <option value="desktop">{t('capture.device_desktop')}</option>
                <option value="tablet">{t('capture.device_tablet')}</option>
                <option value="mobile">{t('capture.device_mobile')}</option>
              </select>
            </label>
            <label className="block text-sm">{t('picker.radius')}
              <input type="number" min={0} className="input mt-1" value={s.cornerRadius} onChange={(e) => update(s.screenId, { cornerRadius: Number(e.target.value) })} data-testid={`radius-${s.screenId}`} />
            </label>
            <label className="block text-sm">{t('picker.zIndex')}
              <input type="number" min={0} max={100} className="input mt-1" value={s.zIndex} onChange={(e) => update(s.screenId, { zIndex: Number(e.target.value) })} />
            </label>
            <label className="block text-sm">{t('picker.mask')} {s.maskUrl && <span className="muted">✓</span>}
              <input type="file" accept="image/png" className="mt-1 block text-xs" onChange={(e) => e.target.files?.[0] && uploadMask(s, e.target.files[0])} />
            </label>
            <div className="flex gap-2 text-xs">
              <button className="btn-ghost" onClick={() => update(s.screenId, { corners: {} })}>{t('picker.reset')}</button>
              <button className="btn-ghost" onClick={() => { setScreens((all) => all.filter((x) => x.screenId !== s.screenId)); setSaved(false); }}>{t('picker.remove')}</button>
            </div>
          </fieldset>
        ))}
        <button className="btn-ghost w-full justify-center" onClick={addScreen} data-testid="add-screen">{t('picker.addScreen')}</button>
        {error && <p role="alert" className="text-sm text-red-600" data-testid="picker-error">{error}</p>}
        <button className="btn w-full justify-center" onClick={save} data-testid="save-screens">{saved ? t('picker.saved') : t('picker.save')}</button>
      </aside>
    </div>
  );
}
