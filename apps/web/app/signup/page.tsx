'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useT } from '@/lib/I18nProvider';

/** SC-3: create an account and workspace on the free plan. */
export default function SignupPage() {
  const t = useT();
  const [error, setError] = useState('');
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await api('/auth/signup', { method: 'POST', json: Object.fromEntries(['name', 'email', 'password', 'workspace'].map((k) => [k, f.get(k)])) });
      location.href = '/';
    } catch (err: any) {
      setError(err.message);
    }
  }
  return (
    <form onSubmit={onSubmit} className="card mx-auto mt-12 max-w-sm space-y-3 p-6">
      <h1 className="text-xl font-bold">{t('signup.title')}</h1>
      <label className="block">{t('signup.name')}<input name="name" className="input mt-1" required /></label>
      <label className="block">{t('login.email')}<input name="email" type="email" className="input mt-1" required /></label>
      <label className="block">{t('login.password')}<input name="password" type="password" minLength={10} className="input mt-1" required /></label>
      <label className="block">{t('signup.workspace')}<input name="workspace" className="input mt-1" /></label>
      {error && <p role="alert" className="text-red-600" data-testid="signup-error">{error}</p>}
      <button className="btn w-full justify-center" type="submit">{t('signup.submit')}</button>
    </form>
  );
}
