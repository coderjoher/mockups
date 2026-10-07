'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useT } from '@/lib/I18nProvider';

export default function AdminMockups() {
  const t = useT();
  const [mockups, setMockups] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => api('/admin/mockups').then((r) => setMockups(r.mockups), (e) => setError(e.message));
  useEffect(() => void load(), []);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setBusy(true);
    const form = new FormData();
    form.append('file', file);
    try {
      const r = await api('/admin/mockups', { method: 'POST', body: form });
      location.href = `/admin/mockups/${r.mockup.id}`;
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
    e.target.value = '';
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{t('admin.title')}</h1>
        <label className={`btn ms-auto cursor-pointer ${busy ? 'opacity-50' : ''}`}>
          {t('admin.upload')}
          <input type="file" accept="image/jpeg,image/png" className="hidden" onChange={upload} data-testid="mockup-upload" disabled={busy} />
        </label>
      </div>
      {error && <p role="alert" className="text-red-600" data-testid="admin-error">{error}</p>}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="admin-mockups">
        {mockups.map((m) => (
          <li key={m.id} className="card overflow-hidden">
            <Link href={`/admin/mockups/${m.id}`} className="block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.thumb_url} alt="" className="aspect-[4/3] w-full object-cover" loading="lazy" />
              <div className="flex items-center gap-2 p-3 text-sm">
                <span className="font-medium">{m.title}</span>
                <span className={`ms-auto rounded px-2 py-0.5 text-xs ${m.status === 'published' ? 'bg-green-100 text-green-800' : 'bg-gray-100'}`}>{t(`admin.${m.status}`)}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
