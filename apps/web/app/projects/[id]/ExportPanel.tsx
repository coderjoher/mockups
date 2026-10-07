'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useT } from '@/lib/I18nProvider';

const FORMATS = ['png', 'webp', 'jpg'] as const;

/** EX-1 / EX-3: choose formats, then download the whole set as one ZIP. */
export function ExportPanel({ projectId, setSize }: { projectId: string; setSize: number }) {
  const t = useT();
  const [formats, setFormats] = useState<string[]>(['png']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function exportZip() {
    setBusy(true);
    setError('');
    try {
      const { jobId } = await api(`/projects/${projectId}/exports`, { method: 'POST', json: { formats } });
      for (;;) {
        const s = await api(`/projects/${projectId}/exports/${jobId}`);
        if (s.status === 'failed') throw new Error(s.error ?? 'Export failed');
        if (s.status === 'done' && s.url) {
          const a = document.createElement('a');
          a.href = s.url;
          a.download = '';
          document.body.appendChild(a);
          a.click();
          a.remove();
          break;
        }
        await new Promise((r) => setTimeout(r, 600));
      }
    } catch (e: any) {
      setError(e.message);
    }
    setBusy(false);
  }

  return (
    <div className="card space-y-2 p-3" data-testid="export-panel">
      <div className="text-sm font-semibold">{t('export.title', { n: setSize })}</div>
      <div className="flex gap-3 text-sm">
        {FORMATS.map((f) => (
          <label key={f} className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={formats.includes(f)}
              onChange={(e) => setFormats((all) => (e.target.checked ? [...all, f] : all.filter((x) => x !== f)))}
              data-testid={`format-${f}`}
            />
            {f.toUpperCase()}
          </label>
        ))}
      </div>
      <button className="btn w-full justify-center" disabled={busy || !setSize || !formats.length} onClick={exportZip} data-testid="download-zip">
        {busy ? t('export.preparing') : t('export.zip')}
      </button>
      {error && <p role="alert" className="text-sm text-red-600" data-testid="export-error">{error}</p>}
    </div>
  );
}
