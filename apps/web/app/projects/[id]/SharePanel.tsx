'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useT } from '@/lib/I18nProvider';

/** EX-4: read-only gallery links that can be turned off. */
export function SharePanel({ projectId }: { projectId: string }) {
  const t = useT();
  const [links, setLinks] = useState<any[]>([]);
  const load = () => api(`/projects/${projectId}/share`).then((r) => setLinks(r.links));
  useEffect(() => void load(), [projectId]);
  const active = links.filter((l) => !l.revoked_at);
  const url = (token: string) => `${location.origin}/share/${token}`;
  return (
    <details className="mt-2 text-sm" data-testid="share-panel">
      <summary className="cursor-pointer text-[var(--accent)]">{t('share.title')}</summary>
      <div className="mt-2 space-y-2">
        <button className="btn-ghost" onClick={async () => { await api(`/projects/${projectId}/share`, { method: 'POST' }); await load(); }} data-testid="share-create">{t('share.create')}</button>
        {active.map((l) => (
          <div key={l.id} className="flex items-center gap-2">
            <input readOnly className="input" dir="ltr" value={url(l.token)} data-testid="share-url" onFocus={(e) => e.target.select()} />
            <button className="btn-ghost" onClick={() => navigator.clipboard?.writeText(url(l.token))}>{t('share.copy')}</button>
            <button className="btn-ghost" onClick={async () => { await api(`/share-links/${l.id}`, { method: 'DELETE' }); await load(); }} data-testid="share-revoke">{t('share.revoke')}</button>
          </div>
        ))}
      </div>
    </details>
  );
}
