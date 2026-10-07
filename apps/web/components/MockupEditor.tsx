'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useT } from '@/lib/I18nProvider';
import { CornerPicker } from '@/components/CornerPicker';

const OPTIONS = {
  device_type: ['desktop', 'laptop', 'tablet', 'mobile', 'multi'],
  scene: ['desk', 'hand', 'studio', 'outdoor'],
  tone: ['light', 'dark', 'warm', 'cool'],
} as const;
const LIB_KEY = { device_type: 'device', scene: 'scene', tone: 'tone' } as const;

export function MockupEditor({ id }: { id: string }) {
  const t = useT();
  const [mockup, setMockup] = useState<any>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    api(`/mockups/${id}`).then((r) => setMockup(r.mockup), (e) => setError(e.message));
  }, [id]);
  if (!mockup) return error ? <p className="text-red-600">{error}</p> : null;

  async function saveDetails(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setNote('');
    const f = new FormData(e.currentTarget);
    const body: Record<string, unknown> = Object.fromEntries(['title', 'tags', 'device_type', 'scene', 'tone', 'licence_source', 'licence_type', 'attribution'].map((k) => [k, f.get(k) ?? '']));
    body.attribution_required = f.get('attribution_required') === 'on';
    try {
      const r = await api(`/admin/mockups/${id}`, { method: 'PATCH', json: body });
      setMockup(r.mockup);
      setNote(t('picker.saved'));
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function setStatus(action: 'publish' | 'unpublish') {
    setError('');
    try {
      const r = await api(`/admin/mockups/${id}/${action}`, { method: 'POST' });
      setMockup(r.mockup);
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/mockups" className="btn-ghost">{t('admin.back')}</Link>
        <h1 className="text-2xl font-bold">{mockup.title}</h1>
        <span className="muted text-sm" data-testid="mockup-status">{t(`admin.${mockup.status}`)}</span>
        <span className="muted text-sm" dir="ltr">{mockup.width} × {mockup.height}</span>
        {mockup.status === 'draft' ? (
          <button className="btn ms-auto" onClick={() => setStatus('publish')} data-testid="publish">{t('admin.publish')}</button>
        ) : (
          <button className="btn-ghost ms-auto" onClick={() => setStatus('unpublish')} data-testid="unpublish">{t('admin.unpublish')}</button>
        )}
      </div>
      {error && <p role="alert" className="text-red-600" data-testid="editor-error">{error}</p>}
      <CornerPicker mockup={mockup} onSaved={setMockup} />
      <form onSubmit={saveDetails} className="card grid gap-3 p-4 sm:grid-cols-2" data-testid="details-form">
        <h2 className="text-lg font-semibold sm:col-span-2">{t('admin.details')}</h2>
        <label className="text-sm">{t('admin.titleField')}<input name="title" className="input mt-1" defaultValue={mockup.title} /></label>
        <label className="text-sm">{t('admin.tags')}<input name="tags" className="input mt-1" defaultValue={mockup.tags.join(', ')} /></label>
        {(Object.keys(OPTIONS) as (keyof typeof OPTIONS)[]).map((k) => (
          <label key={k} className="text-sm">{t(`library.${LIB_KEY[k]}`)}
            <select name={k} className="input mt-1" defaultValue={mockup[k] ?? ''}>
              <option value="">—</option>
              {OPTIONS[k].map((v) => <option key={v} value={v}>{t(`library.${LIB_KEY[k]}_${v}`)}</option>)}
            </select>
          </label>
        ))}
        <label className="text-sm">{t('admin.licenceSource')}<input name="licence_source" className="input mt-1" defaultValue={mockup.licence_source ?? ''} /></label>
        <label className="text-sm">{t('admin.licenceType')}
          <input name="licence_type" className="input mt-1" list="licence-types" defaultValue={mockup.licence_type ?? ''} />
          <datalist id="licence-types">
            <option value="In-house (owned)" /><option value="Unsplash License" /><option value="Pexels License" /><option value="Freepik Premium" /><option value="Envato Elements" /><option value="CC BY 4.0" /><option value="CC0" />
          </datalist>
        </label>
        <label className="text-sm">{t('admin.attribution')}<input name="attribution" className="input mt-1" defaultValue={mockup.attribution ?? ''} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="attribution_required" defaultChecked={mockup.attribution_required} />{t('admin.attributionRequired')}</label>
        <div className="flex items-center gap-3 sm:col-span-2">
          <button className="btn" type="submit" data-testid="save-details">{t('admin.saveDetails')}</button>
          {note && <span className="muted text-sm">{note}</span>}
        </div>
      </form>
    </div>
  );
}
