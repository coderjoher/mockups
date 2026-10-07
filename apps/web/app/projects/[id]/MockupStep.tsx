'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useT } from '@/lib/I18nProvider';
import { MockupGrid } from '@/components/MockupGrid';
import type { Capture } from './Gallery';
import { ExportPanel } from './ExportPanel';

type Assignments = Record<string, { captureId: string; scrollOffset: number }>;

async function waitForRender(id: string, signal: { cancelled: boolean }): Promise<any> {
  for (;;) {
    const { render } = await api(`/renders/${id}`);
    if (render.status === 'done' || render.status === 'failed' || signal.cancelled) return render;
    await new Promise((r) => setTimeout(r, 400));
  }
}

/** Pick a mockup photo, see a live preview, assign pages to screens (CR-2) and render full size. */
export function MockupStep({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const t = useT();
  const [mockup, setMockup] = useState<any>(null);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [assignments, setAssignments] = useState<Assignments>({});
  const [preview, setPreview] = useState<any>(null);
  const [final, setFinal] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = useRef({ cancelled: false });
  const [setSize, setSetSize] = useState(0);

  const loadSet = useCallback(async () => {
    const { renders } = await api(`/projects/${projectId}/renders`);
    const finals = renders.filter((r: any) => r.status === 'done' && !r.options?.preview);
    setSetSize(new Set(finals.map((r: any) => `${r.mockup_id}:${JSON.stringify(r.assignments)}`)).size);
  }, [projectId]);
  useEffect(() => void loadSet(), [loadSet]);

  useEffect(() => {
    api(`/projects/${projectId}/captures`).then((r) => setCaptures(r.captures.filter((c: Capture) => c.status === 'done')));
  }, [projectId]);

  const renderPreview = useCallback(
    async (m: any, a: Assignments) => {
      run.current.cancelled = true;
      const signal = { cancelled: false };
      run.current = signal;
      setError('');
      setFinal(null);
      try {
        const { render } = await api(`/projects/${projectId}/renders`, { method: 'POST', json: { mockupId: m.id, assignments: a, preview: true } });
        const done = await waitForRender(render.id, signal);
        if (signal.cancelled) return;
        if (done.status === 'failed') setError(done.error ?? 'Render failed');
        setPreview(done);
      } catch (e: any) {
        setError(e.message);
      }
    },
    [projectId],
  );

  async function pick(m: any) {
    setMockup(m);
    setPreview(null);
    try {
      const { assignments: a } = await api(`/projects/${projectId}/assignments?mockupId=${m.id}`);
      setAssignments(a);
      await renderPreview(m, a);
    } catch (e: any) {
      setError(e.message);
    }
  }

  function assign(screenKey: string, captureId: string) {
    const next = { ...assignments, [screenKey]: { captureId, scrollOffset: 0 } };
    setAssignments(next);
    void renderPreview(mockup, next);
  }

  async function renderFinal() {
    setBusy(true);
    setError('');
    try {
      const { render } = await api(`/projects/${projectId}/renders`, { method: 'POST', json: { mockupId: mockup.id, assignments, formats: ['png'] } });
      const done = await waitForRender(render.id, { cancelled: false });
      if (done.status === 'failed') setError(done.error ?? 'Render failed');
      setFinal(done);
      await loadSet();
    } catch (e: any) {
      setError(e.message);
    }
    setBusy(false);
  }

  const options = useMemo(() => captures.map((c) => ({ id: c.id, label: `${c.title} · ${t(`capture.device_${c.device}`)}${c.mode === 'full' ? ` · ${t('capture.full')}` : ''}`, device: c.device })), [captures, t]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-ghost" onClick={onBack}>{t('mockup.back')}</button>
        <h2 className="text-lg font-semibold">{t('mockup.title')}</h2>
      </div>
      {error && <p role="alert" className="text-red-600" data-testid="render-error">{error}</p>}
      {mockup && (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="card flex min-h-64 items-center justify-center overflow-hidden p-2">
            {preview?.urls?.preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.urls.preview} alt={mockup.title} className="max-h-[70vh] w-auto" data-testid="render-preview" />
            ) : (
              <span className="muted" data-testid="render-pending">{t('mockup.rendering')}</span>
            )}
          </div>
          <aside className="space-y-3">
            <h3 className="font-semibold">{mockup.title}</h3>
            {mockup.screens.map((s: any) => (
              <label key={s.screen_key} className="block text-sm">
                {t('mockup.screen', { screen: s.screen_key, device: t(`capture.device_${s.device}`) })}
                <select className="input mt-1" value={assignments[s.screen_key]?.captureId ?? ''} onChange={(e) => assign(s.screen_key, e.target.value)} data-testid={`assign-${s.screen_key}`}>
                  {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </label>
            ))}
            <button className="btn w-full justify-center" disabled={busy || !preview} onClick={renderFinal} data-testid="render-final">{busy ? t('mockup.rendering') : t('mockup.final')}</button>
            {final?.downloads?.png && (
              <a className="btn-ghost w-full justify-center" href={final.downloads.png} download data-testid="download-png">{t('mockup.download')}</a>
            )}
            <ExportPanel projectId={projectId} setSize={setSize} />
            <button className="btn-ghost w-full justify-center" onClick={() => setMockup(null)}>{t('mockup.change')}</button>
          </aside>
        </div>
      )}
      {!mockup && <MockupGrid onPick={pick} />}
    </section>
  );
}
