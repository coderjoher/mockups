'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useT } from '@/lib/I18nProvider';

/** EX-4: the public, read-only view of a project's finished mockups. */
export function SharedGallery({ token }: { token: string }) {
  const t = useT();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api(`/share/${encodeURIComponent(token)}`).then(setData, (e) => setError(e.message));
  }, [token]);
  if (error) return <p className="text-red-600" data-testid="share-error">{error}</p>;
  if (!data) return null;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold" data-testid="share-title">{data.title}</h1>
      <ul className="grid gap-4 sm:grid-cols-2" data-testid="share-renders">
        {data.renders.map((r: any) => (
          <li key={r.id} className="card overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={r.urls.png ?? r.urls.jpg ?? r.urls.webp} alt="" className="w-full" />
            {r.downloads?.png && <a className="block p-3 text-sm text-[var(--accent)] underline" href={r.downloads.png} download>{t('mockup.download')}</a>}
          </li>
        ))}
      </ul>
    </div>
  );
}
