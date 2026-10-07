'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useT } from '@/lib/I18nProvider';

export interface Style {
  bg: { type: 'solid'; colour: string } | { type: 'gradient'; from: string; to: string; angle: number };
  padding: number;
  shadow: number;
  headline: string;
  logoKey?: string;
}

export const DEFAULT_STYLE: Style = { bg: { type: 'solid', colour: '#f4f4f2' }, padding: 80, shadow: 0.6, headline: '' };

/** CX-2 background, padding and shadow; CX-3 brand colour swatches; CX-4 headline and client logo. */
export function LayoutStyle({ projectId, brand, value, onChange }: { projectId: string; brand: string[]; value: Style; onChange: (s: Style) => void }) {
  const t = useT();
  const [logoError, setLogoError] = useState('');
  const bg = value.bg;
  const setBg = (b: Style['bg']) => onChange({ ...value, bg: b });

  async function uploadLogo(file: File) {
    setLogoError('');
    const form = new FormData();
    form.append('file', file);
    try {
      const r = await api(`/projects/${projectId}/logo`, { method: 'POST', body: form });
      onChange({ ...value, logoKey: r.key });
    } catch (e: any) {
      setLogoError(e.message);
    }
  }

  return (
    <div className="grid gap-3 text-sm sm:grid-cols-2" data-testid="layout-style">
      <label>{t('style.background')}
        <select className="input mt-1" value={bg.type} onChange={(e) => setBg(e.target.value === 'gradient' ? { type: 'gradient', from: '#eef2ff', to: '#c7d2fe', angle: 135 } : { type: 'solid', colour: '#f4f4f2' })} data-testid="bg-type">
          <option value="solid">{t('style.solid')}</option>
          <option value="gradient">{t('style.gradient')}</option>
        </select>
      </label>
      <div className="flex items-end gap-2">
        {bg.type === 'solid' ? (
          <input type="color" value={bg.colour} onChange={(e) => setBg({ type: 'solid', colour: e.target.value })} aria-label={t('style.colour')} data-testid="bg-colour" />
        ) : (
          <>
            <input type="color" value={bg.from} onChange={(e) => setBg({ ...bg, from: e.target.value })} aria-label={t('style.from')} />
            <input type="color" value={bg.to} onChange={(e) => setBg({ ...bg, to: e.target.value })} aria-label={t('style.to')} />
          </>
        )}
      </div>
      {brand.length > 0 && (
        <div className="sm:col-span-2">
          <div className="muted text-xs">{t('style.brand')}</div>
          <div className="mt-1 flex gap-2" data-testid="brand-swatches">
            {brand.map((c) => (
              <button key={c} title={c} className="h-7 w-7 rounded-full border border-[var(--line)]" style={{ background: c }} onClick={() => setBg({ type: 'solid', colour: c })} data-testid="brand-swatch" />
            ))}
            {brand.length > 1 && (
              <button className="h-7 w-14 rounded-full border border-[var(--line)]" style={{ background: `linear-gradient(135deg, ${brand[0]}, ${brand[1]})` }} onClick={() => setBg({ type: 'gradient', from: brand[0], to: brand[1], angle: 135 })} aria-label={t('style.brandGradient')} />
            )}
          </div>
        </div>
      )}
      <label>{t('style.padding')}<input type="range" min={0} max={300} value={value.padding} onChange={(e) => onChange({ ...value, padding: Number(e.target.value) })} className="w-full" /></label>
      <label>{t('style.shadow')}<input type="range" min={0} max={1} step={0.1} value={value.shadow} onChange={(e) => onChange({ ...value, shadow: Number(e.target.value) })} className="w-full" /></label>
      <label className="sm:col-span-2">{t('style.headline')}<input className="input mt-1" value={value.headline} onChange={(e) => onChange({ ...value, headline: e.target.value })} data-testid="headline" /></label>
      <label className="sm:col-span-2">{t('style.logo')} {value.logoKey && '✓'}
        <input type="file" accept="image/png,image/jpeg,image/webp" className="mt-1 block text-xs" onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} data-testid="logo-upload" />
      </label>
      {logoError && <p className="text-red-600">{logoError}</p>}
    </div>
  );
}
