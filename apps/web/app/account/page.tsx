'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useT } from '@/lib/I18nProvider';

/** SC-3 plan and usage; SC-2 API keys (each key is shown once). */
export default function AccountPage() {
  const t = useT();
  const [billing, setBilling] = useState<any>(null);
  const [keys, setKeys] = useState<any[]>([]);
  const [fresh, setFresh] = useState('');
  const [name, setName] = useState('');
  const load = async () => {
    setBilling(await api('/billing'));
    setKeys((await api('/api-keys')).keys);
  };
  useEffect(() => void load().catch(() => (location.href = '/login')), []);
  if (!billing) return null;
  const limit = (n: number | null) => (n == null ? '∞' : n);
  return (
    <div className="space-y-6">
      <section className="card space-y-1 p-4" data-testid="plan">
        <h1 className="text-xl font-bold">{t('account.title')}</h1>
        <p>{t('account.plan')}: <b data-testid="plan-name">{billing.plan}</b></p>
        <p className="muted text-sm" data-testid="usage">
          {t('account.usage', { projects: billing.usage.projects ?? 0, projectsMax: limit(billing.limits.projectsPerMonth), pages: billing.usage.pages ?? 0, pagesMax: limit(billing.limits.pagesPerMonth) })}
        </p>
      </section>
      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">{t('account.apiKeys')}</h2>
        <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); const r = await api('/api-keys', { method: 'POST', json: { name } }); setFresh(r.key); setName(''); await load(); }}>
          <input className="input" placeholder={t('account.keyName')} value={name} onChange={(e) => setName(e.target.value)} data-testid="key-name" />
          <button className="btn" type="submit" data-testid="key-create">{t('account.createKey')}</button>
        </form>
        {fresh && <p className="rounded bg-amber-50 p-2 text-sm" data-testid="key-fresh">{t('account.copyNow')} <code dir="ltr">{fresh}</code></p>}
        <ul className="divide-y divide-[var(--line)] text-sm" data-testid="key-list">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center gap-2 py-2">
              <span className="font-medium">{k.name}</span>
              <code className="muted" dir="ltr">{k.prefix}…</code>
              {k.revoked_at ? <span className="muted ms-auto">{t('account.revoked')}</span> : (
                <button className="btn-ghost ms-auto" onClick={async () => { await api(`/api-keys/${k.id}`, { method: 'DELETE' }); await load(); }}>{t('share.revoke')}</button>
              )}
            </li>
          ))}
        </ul>
        <a className="text-sm text-[var(--accent)] underline" href="/api/v1/openapi.json" target="_blank" rel="noreferrer">{t('account.docs')}</a>
      </section>
    </div>
  );
}
