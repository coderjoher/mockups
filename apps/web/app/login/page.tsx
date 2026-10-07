'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useT } from '@/lib/I18nProvider';

export default function LoginPage() {
  const t = useT();
  const [error, setError] = useState('');
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    try {
      await api('/auth/login', { method: 'POST', json: { email: form.get('email'), password: form.get('password') } });
      location.href = '/';
    } catch {
      setError(t('login.error'));
    }
  }
  return (
    <form onSubmit={onSubmit} className="card mx-auto mt-12 max-w-sm space-y-3 p-6">
      <h1 className="text-xl font-bold">{t('login.title')}</h1>
      <label className="block">{t('login.email')}<input name="email" type="email" className="input mt-1" required /></label>
      <label className="block">{t('login.password')}<input name="password" type="password" className="input mt-1" required /></label>
      {error && <p role="alert" className="text-red-600">{error}</p>}
      <button className="btn w-full justify-center" type="submit">{t('login.submit')}</button>
      <a className="block text-center text-sm text-[var(--accent)] underline" href="/signup">{t('signup.link')}</a>
    </form>
  );
}
