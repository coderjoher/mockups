'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useLocale, useT } from '@/lib/I18nProvider';

export function Nav({ appName }: { appName: string }) {
  const t = useT();
  const locale = useLocale();
  const [user, setUser] = useState<{ name: string; role: string } | null>(null);
  useEffect(() => {
    api('/me').then((r) => setUser(r.user), () => setUser(null));
  }, []);

  function switchLanguage() {
    document.cookie = `locale=${locale === 'ar' ? 'en' : 'ar'}; path=/; max-age=31536000`;
    location.reload();
  }

  async function signOut() {
    await api('/auth/logout', { method: 'POST' });
    location.href = '/login';
  }

  return (
    <header className="border-b border-[var(--line)] bg-white">
      <nav className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
        <Link href="/" className="font-bold">{appName}</Link>
        {user && <Link href="/" className="muted">{t('nav.projects')}</Link>}
        {user && <Link href="/library" className="muted">{t('nav.library')}</Link>}
        {user?.role === 'admin' && <Link href="/admin/mockups" className="muted">{t('nav.admin')}</Link>}
        {user && <Link href="/account" className="muted">{t('nav.account')}</Link>}
        <span className="ms-auto" />
        <button data-testid="lang-switch" className="btn-ghost" onClick={switchLanguage}>{t('nav.language')}</button>
        {user && <button className="btn-ghost" onClick={signOut}>{t('nav.signOut')}</button>}
      </nav>
    </header>
  );
}
