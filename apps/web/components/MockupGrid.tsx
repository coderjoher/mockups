'use client';
import { useEffect, useRef, useState } from 'react';
import { matrix3d, type Pt } from '@/lib/matrix3d';
import { api } from '@/lib/api';
import { useT } from '@/lib/I18nProvider';

const FILTERS = {
  device: ['desktop', 'laptop', 'tablet', 'mobile', 'multi'],
  scene: ['desk', 'hand', 'studio', 'outdoor'],
  tone: ['light', 'dark', 'warm', 'cool'],
  orientation: ['landscape', 'portrait', 'square'],
} as const;
type FilterKey = keyof typeof FILTERS;

/** ML-1: grid of published mockup photos with filters. */
/** ML-2: the card's photo with the user's own captures warped onto its screens (client-side, no render job). */
export function LivePreview({ mockup, captures }: { mockup: any; captures: Record<string, { image_url: string | null }> }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const scale = width / mockup.width;
  return (
    <div ref={box} className="relative overflow-hidden" style={{ aspectRatio: `${mockup.width} / ${mockup.height}` }} data-testid="live-preview">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={mockup.thumb_url} alt={mockup.title} className="absolute inset-0 h-full w-full" loading="lazy" />
      {width > 0 &&
        mockup.screens.map((s: any) => {
          const cap = captures[s.device] ?? Object.values(captures)[0];
          if (!cap?.image_url) return null;
          const c = s.corners;
          const quad = (['tl', 'tr', 'br', 'bl'] as const).map((k) => [c[k][0] * scale, c[k][1] * scale]) as [Pt, Pt, Pt, Pt];
          const w = Math.hypot(c.tr[0] - c.tl[0], c.tr[1] - c.tl[1]);
          const h = Math.hypot(c.bl[0] - c.tl[0], c.bl[1] - c.tl[1]);
          const bw = 400;
          const bh = Math.max(1, Math.round((bw * h) / w));
          let transform = '';
          try {
            transform = matrix3d(bw, bh, quad);
          } catch {
            return null;
          }
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={s.screen_key}
              src={cap.image_url}
              alt=""
              data-testid="live-screen"
              className="absolute left-0 top-0 origin-top-left object-cover object-top"
              style={{ width: bw, height: bh, transform, zIndex: s.z_index, borderRadius: (s.corner_radius * bw) / w }}
            />
          );
        })}
    </div>
  );
}

export function MockupGrid({ onPick, selectedId, extra, homeCaptures }: { onPick?: (m: any) => void; selectedId?: string; extra?: (m: any) => React.ReactNode; homeCaptures?: Record<string, { image_url: string | null }> }) {
  const t = useT();
  const [filters, setFilters] = useState<Partial<Record<FilterKey, string>>>({});
  const [q, setQ] = useState('');
  const [onlyFavs, setOnlyFavs] = useState(false);
  const [mockups, setMockups] = useState<any[] | null>(null);
  const [recent, setRecent] = useState<any[]>([]);

  useEffect(() => {
    const params = new URLSearchParams(Object.entries({ ...filters, q, favourites: onlyFavs ? '1' : '' }).filter(([, v]) => v) as [string, string][]);
    api(`/mockups?${params}`).then((r) => setMockups(r.mockups));
  }, [filters, q, onlyFavs]);
  useEffect(() => {
    api('/mockups/recent').then((r) => setRecent(r.mockups), () => {});
  }, []);

  async function toggleFavourite(m: any) {
    await api(`/mockups/${m.id}/favourite`, { method: m.favourite ? 'DELETE' : 'PUT' });
    const flip = (list: any[]) => list.map((x) => (x.id === m.id ? { ...x, favourite: !m.favourite } : x));
    setMockups((all) => (onlyFavs && m.favourite ? all?.filter((x) => x.id !== m.id) ?? null : flip(all ?? [])));
    setRecent(flip);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        {(Object.keys(FILTERS) as FilterKey[]).map((k) => (
          <label key={k} className="text-sm">
            {t(`library.${k}`)}
            <select className="input mt-1 w-auto" value={filters[k] ?? ''} onChange={(e) => setFilters((f) => ({ ...f, [k]: e.target.value || undefined }))} data-testid={`filter-${k}`}>
              <option value="">{t('library.all')}</option>
              {FILTERS[k].map((v) => <option key={v} value={v}>{t(`library.${k}_${v}`)}</option>)}
            </select>
          </label>
        ))}
        <label className="flex items-end gap-2 text-sm">
          <input type="checkbox" checked={onlyFavs} onChange={(e) => setOnlyFavs(e.target.checked)} data-testid="only-favourites" />
          {t('library.favourites')}
        </label>
        <label className="text-sm">
          {t('library.search')}
          <input className="input mt-1" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      {recent.length > 0 && !onlyFavs && (
        <section>
          <h3 className="mb-2 text-sm font-semibold">{t('library.recent')}</h3>
          <ul className="flex gap-3 overflow-x-auto" data-testid="recent-row">
            {recent.map((m) => (
              <li key={m.id} className="w-40 shrink-0">
                <button type="button" onClick={() => onPick?.(m)} className="card block w-full overflow-hidden text-start">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.thumb_url} alt={m.title} className="aspect-[4/3] w-full object-cover" />
                  <div className="truncate p-2 text-xs">{m.title}</div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {mockups?.length === 0 && <p className="muted">{t('library.empty')}</p>}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="mockup-grid">
        {mockups?.map((m) => (
          <li key={m.id} data-testid="mockup-card" data-mockup-id={m.id} className="relative">
            <button
              type="button"
              aria-pressed={!!m.favourite}
              aria-label={t('library.favourite')}
              onClick={() => toggleFavourite(m)}
              className={`absolute end-2 top-2 z-10 rounded-full bg-white/90 px-2 py-1 text-sm shadow ${m.favourite ? 'text-red-500' : 'text-gray-400'}`}
              data-testid="favourite"
            >
              {m.favourite ? '♥' : '♡'}
            </button>
            <button
              type="button"
              onClick={() => onPick?.(m)}
              className={`card block w-full overflow-hidden text-start ${selectedId === m.id ? 'ring-2 ring-[var(--accent)]' : ''}`}
            >
              {extra?.(m) ?? (homeCaptures && Object.keys(homeCaptures).length ? <LivePreview mockup={m} captures={homeCaptures} /> : null) ?? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.thumb_url} alt={m.title} className="aspect-[4/3] w-full object-cover" loading="lazy" />
              )}
              <div className="p-3">
                <div className="font-medium">{m.title}</div>
                <div className="muted text-xs">
                  {[m.device_type && t(`library.device_${m.device_type}`), m.scene && t(`library.scene_${m.scene}`), t('library.screens', { n: m.screens.length })].filter(Boolean).join(' · ')}
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
