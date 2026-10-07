'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/I18nProvider';

interface ProjectSummary { id: string; title: string; root_url: string; selected_pages: number }

export function HomeClient() {
  const t = useT();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);

  useEffect(() => {
    api('/projects').then((r) => setProjects(r.projects), (e) => {
      if (e instanceof ApiError && e.status === 401) location.href = '/login';
    });
  }, []);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { project } = await api('/projects', { method: 'POST', json: { url } });
      location.href = `/projects/${project.id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <form onSubmit={start} className="card space-y-3 p-6">
        <h1 className="text-2xl font-bold">{t('home.title')}</h1>
        <div className="flex gap-2">
          <input data-testid="url-input" className="input" dir="ltr" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t('home.placeholder')} required />
          <button className="btn" disabled={busy} type="submit">{busy ? t('home.checking') : t('home.start')}</button>
        </div>
        {error && <p role="alert" data-testid="url-error" className="text-red-600">{error}</p>}
      </form>
      <section>
        <h2 className="mb-3 text-lg font-semibold">{t('home.recent')}</h2>
        {projects?.length === 0 && <p className="muted">{t('home.empty')}</p>}
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects?.map((p) => (
            <li key={p.id}>
              <Link href={`/projects/${p.id}`} className="card block p-4 hover:border-[var(--accent)]">
                <div className="font-semibold">{p.title}</div>
                <div className="muted truncate text-sm" dir="ltr">{p.root_url}</div>
                <div className="muted text-xs">{t('home.pages', { n: p.selected_pages })}</div>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
