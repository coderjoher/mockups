'use client';
import { useEffect, useState } from 'react';
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
export function MockupGrid({ onPick, selectedId, extra }: { onPick?: (m: any) => void; selectedId?: string; extra?: (m: any) => React.ReactNode }) {
  const t = useT();
  const [filters, setFilters] = useState<Partial<Record<FilterKey, string>>>({});
  const [q, setQ] = useState('');
  const [mockups, setMockups] = useState<any[] | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(Object.entries({ ...filters, q }).filter(([, v]) => v) as [string, string][]);
    api(`/mockups?${params}`).then((r) => setMockups(r.mockups));
  }, [filters, q]);

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
        <label className="text-sm">
          {t('library.search')}
          <input className="input mt-1" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      {mockups?.length === 0 && <p className="muted">{t('library.empty')}</p>}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="mockup-grid">
        {mockups?.map((m) => (
          <li key={m.id} data-testid="mockup-card" data-mockup-id={m.id}>
            <button
              type="button"
              onClick={() => onPick?.(m)}
              className={`card block w-full overflow-hidden text-start ${selectedId === m.id ? 'ring-2 ring-[var(--accent)]' : ''}`}
            >
              {extra?.(m) ?? (
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
