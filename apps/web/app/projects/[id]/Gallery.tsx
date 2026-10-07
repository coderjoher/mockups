'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useT } from '@/lib/I18nProvider';
import { usePoll } from '@/lib/usePoll';

const DEVICES = ['desktop', 'tablet', 'mobile'] as const;
export interface Capture { id: string; page_id: string; device: string; mode: 'fold' | 'full'; status: string; error: string | null; image_url: string | null; url: string; title: string; source: string; width: number; height: number }

/** CE-11: pages as rows, devices as columns, with per-cell status. */
export function Gallery({ projectId, onBack, onNext }: { projectId: string; onBack: () => void; onNext: (captures: Capture[]) => void }) {
  const t = useT();
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [mode, setMode] = useState<'fold' | 'full'>('fold');
  const [error, setError] = useState('');
  const [dark, setDark] = useState(false);
  const [hide, setHide] = useState('');
  const [delay, setDelay] = useState(0);

  const load = useCallback(async () => setCaptures((await api(`/projects/${projectId}/captures`)).captures), [projectId]);
  useEffect(() => void load(), [load]);
  const busy = captures.some((c) => c.status === 'queued' || c.status === 'running');
  usePoll(load, 1000, busy);

  const shown = captures.filter((c) => c.mode === mode);
  const rows = useMemo(() => {
    const byPage = new Map<string, { page_id: string; title: string; url: string; cells: Record<string, Capture> }>();
    for (const c of shown) {
      const row = byPage.get(c.page_id) ?? { page_id: c.page_id, title: c.title, url: c.url, cells: {} };
      row.cells[c.device] = c;
      byPage.set(c.page_id, row);
    }
    return [...byPage.values()];
  }, [shown]);
  const done = shown.filter((c) => c.status === 'done').length;

  async function start() {
    setError('');
    try {
      const options = { dark, hideSelectors: hide.split(',').map((s) => s.trim()).filter(Boolean), delayMs: delay * 1000 };
      await api(`/projects/${projectId}/captures`, { method: 'POST', json: { mode, options } });
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-ghost" onClick={onBack}>{t('capture.back')}</button>
        <h2 className="text-lg font-semibold">{t('capture.title')}</h2>
        <label className="ms-auto flex items-center gap-2 text-sm">
          {t('capture.mode')}
          <select className="input w-auto" value={mode} onChange={(e) => setMode(e.target.value as 'fold' | 'full')} data-testid="capture-mode">
            <option value="fold">{t('capture.fold')}</option>
            <option value="full">{t('capture.full')}</option>
          </select>
        </label>
        <button className="btn" onClick={start} disabled={busy} data-testid="start-capture">{t('capture.start')}</button>
      </div>
      <details className="card p-3 text-sm" data-testid="capture-options">
        <summary className="cursor-pointer font-medium">{t('capture.options')}</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="flex items-center gap-2"><input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} data-testid="opt-dark" />{t('capture.dark')}</label>
          <label>{t('capture.hide')}<input className="input mt-1" dir="ltr" value={hide} onChange={(e) => setHide(e.target.value)} placeholder=".promo, #newsletter" data-testid="opt-hide" /></label>
          <label>{t('capture.delay')}<input className="input mt-1" type="number" min={0} max={10} value={delay} onChange={(e) => setDelay(Number(e.target.value))} data-testid="opt-delay" /></label>
        </div>
      </details>
      {error && <p role="alert" className="text-red-600" data-testid="capture-error">{error}</p>}
      {shown.length > 0 && <p data-testid="capture-progress" className="muted text-sm">{t('capture.progress', { done, total: shown.length })}</p>}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm" data-testid="gallery">
          <thead>
            <tr className="border-b border-[var(--line)]">
              <th className="p-3 text-start" />
              {DEVICES.map((d) => <th key={d} className="p-3 text-start">{t(`capture.device_${d}`)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.page_id} className="border-b border-[var(--line)] align-top" data-testid="gallery-row">
                <td className="p-3">
                  <div className="font-medium">{row.title}</div>
                  <div className="muted text-xs" dir="ltr">{new URL(row.url).pathname}</div>
                </td>
                {DEVICES.map((d) => (
                  <td key={d} className="p-3" data-testid={`cell-${d}`}>
                    {row.cells[d] ? <Cell capture={row.cells[d]} projectId={projectId} onChange={load} /> : <span className="muted">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn" disabled={!done} onClick={() => onNext(captures.filter((c) => c.status === 'done'))} data-testid="to-mockups">{t('capture.next')}</button>
    </section>
  );
}

export function Cell({ capture, projectId, onChange }: { capture: Capture; projectId: string; onChange: () => void }) {
  const t = useT();
  return (
    <div className="w-40 space-y-1" data-status={capture.status}>
      {capture.status === 'done' && capture.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={capture.image_url} alt={capture.title} className="max-h-48 w-full rounded border border-[var(--line)] object-cover object-top" />
      ) : (
        <div className="flex h-24 items-center justify-center rounded bg-gray-100 text-xs">{t(`capture.status_${capture.status}`)}</div>
      )}
      {capture.status === 'failed' && <p className="text-xs text-red-600" data-testid="capture-reason">{capture.error}</p>}
      <CellActions capture={capture} projectId={projectId} onChange={onChange} />
    </div>
  );
}

function CellActions({ capture, onChange }: { capture: Capture; projectId: string; onChange: () => void }) {
  const t = useT();
  const [error, setError] = useState('');
  if (capture.status === 'queued' || capture.status === 'running') return null;

  async function recapture() {
    setError('');
    try {
      await api(`/captures/${capture.id}/recapture`, { method: 'POST' });
      onChange();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    const form = new FormData();
    form.append('file', file);
    try {
      await api(`/captures/${capture.id}/upload`, { method: 'POST', body: form });
      onChange();
    } catch (err: any) {
      setError(err.message);
    }
    e.target.value = '';
  }

  return (
    <div className="flex flex-col items-start gap-1 text-xs">
      <button className="text-[var(--accent)] underline" onClick={recapture} data-testid="recapture">
        {capture.status === 'failed' ? t('capture.retry') : t('capture.recapture')}
      </button>
      <label className="cursor-pointer text-[var(--accent)] underline">
        {t('capture.upload')}
        <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={upload} data-testid="upload-input" />
      </label>
      {error && <span className="text-red-600" data-testid="cell-error">{error}</span>}
    </div>
  );
}
