'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useT } from '@/lib/I18nProvider';
import { usePoll } from '@/lib/usePoll';

const MAX = 20;
export interface Page { id: string; url: string; title: string; favicon_url: string | null; selected: boolean; template_group: string | null; lang: string | null }

export function Checklist({ projectId, onNext }: { projectId: string; onNext: (pages: Page[]) => void }) {
  const t = useT();
  const [pages, setPages] = useState<Page[]>([]);
  const [discovery, setDiscovery] = useState<any>({ status: 'queued' });
  const [q, setQ] = useState('');
  const [lang, setLang] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [newUrl, setNewUrl] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const r = await api(`/projects/${projectId}/pages`);
    setPages(r.pages);
    setDiscovery(r.discovery);
  }, [projectId]);
  useEffect(() => void load(), [load]);
  const running = discovery?.status === 'queued' || discovery?.status === 'running';
  usePoll(load, 1000, running);

  const languages = useMemo(() => [...new Set(pages.map((p) => p.lang).filter(Boolean))] as string[], [pages]);
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = needle ? pages.filter((p) => p.title.toLowerCase().includes(needle) || p.url.toLowerCase().includes(needle)) : pages;
    if (lang) list = list.filter((p) => p.lang === lang);
    // PD-6: one sample per template group (expandable); searching shows every match.
    if (needle) return list;
    const seen = new Map<string, number>();
    return list.filter((p) => {
      if (!p.template_group || p.selected || open[p.template_group]) return true;
      const n = (seen.get(p.template_group) ?? 0) + 1;
      seen.set(p.template_group, n);
      return n === 1;
    });
  }, [pages, q, lang, open]);
  const groupSize = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of pages) if (p.template_group) m.set(p.template_group, (m.get(p.template_group) ?? 0) + 1);
    return m;
  }, [pages]);
  const selected = pages.filter((p) => p.selected);

  async function toggle(page: Page) {
    setError('');
    if (!page.selected && selected.length >= MAX) return setError(t('pages.limit', { max: MAX }));
    // Optimistic: flip now, then take the server's list (or roll back on error).
    setPages((ps) => ps.map((p) => (p.id === page.id ? { ...p, selected: !p.selected } : p)));
    try {
      const r = await api(`/projects/${projectId}/pages`, { method: 'PATCH', json: { pageIds: [page.id], selected: !page.selected } });
      setPages(r.pages);
    } catch (e: any) {
      setPages((ps) => ps.map((p) => (p.id === page.id ? { ...p, selected: page.selected } : p)));
      setError(e.message);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api(`/projects/${projectId}/pages`, { method: 'POST', json: { url: newUrl } });
      setNewUrl('');
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">{t('pages.title')}</h2>
        <span data-testid="discovery-status" className="muted text-sm">
          {running ? t('pages.discovering') : discovery?.status === 'failed' ? t('pages.failed') : t('pages.found', { n: pages.length })}
        </span>
        <span data-testid="selected-count" className="ms-auto text-sm font-semibold">{t('pages.selected', { n: selected.length, max: MAX })}</span>
      </div>
      {discovery?.capped && (
        <p data-testid="discovery-capped" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          {t('pages.capped', { reason: t(`pages.reason_${discovery.capped}`) })}
        </p>
      )}
      <div className="flex gap-2">
        <input className="input" placeholder={t('pages.search')} value={q} onChange={(e) => setQ(e.target.value)} data-testid="page-search" />
        {languages.length > 1 && (
          <select className="input w-auto" value={lang} onChange={(e) => setLang(e.target.value)} data-testid="lang-filter" aria-label={t('pages.language')}>
            <option value="">{t('pages.allLanguages')}</option>
            {languages.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
          </select>
        )}
      </div>
      {error && <p role="alert" data-testid="pages-error" className="text-red-600">{error}</p>}
      <ul className="card divide-y divide-[var(--line)]" data-testid="page-list">
        {visible.map((p) => (
          <li key={p.id}>
            <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5">
              <input type="checkbox" checked={p.selected} onChange={() => toggle(p)} aria-label={p.title} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.favicon_url ?? ''} alt="" width={16} height={16} className="h-4 w-4" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
              <span className="font-medium">{p.title}</span>
              {p.lang && <span className="rounded bg-gray-100 px-1.5 text-xs uppercase">{p.lang}</span>}
              <span className="muted ms-auto truncate text-sm" dir="ltr">{new URL(p.url).pathname}</span>
            </label>
            {p.template_group && !q && (groupSize.get(p.template_group) ?? 0) > 1 && (
              <button className="ms-11 mb-2 text-xs text-[var(--accent)] underline" data-testid="group-toggle" onClick={() => setOpen((o) => ({ ...o, [p.template_group!]: !o[p.template_group!] }))}>
                {open[p.template_group]
                  ? t('pages.groupCollapse', { group: p.template_group })
                  : t('pages.groupMore', { n: (groupSize.get(p.template_group) ?? 1) - 1, group: p.template_group })}
              </button>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="flex gap-2">
        <input className="input" dir="ltr" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder={t('pages.addPlaceholder')} aria-label={t('pages.add')} data-testid="add-page" />
        <button className="btn-ghost" type="submit">{t('pages.addButton')}</button>
      </form>
      <div className="flex gap-2">
        <button className="btn" data-testid="to-capture" disabled={!selected.length} onClick={() => onNext(selected)}>{t('pages.next', { n: selected.length })}</button>
        <button className="btn-ghost" disabled={running} onClick={async () => { await api(`/projects/${projectId}/discover`, { method: 'POST', json: {} }); setDiscovery({ status: 'queued' }); }}>{t('pages.rediscover')}</button>
      </div>
    </section>
  );
}
