'use client';
import { createContext, useContext } from 'react';
import { translate, type Locale } from './i18n';

const Ctx = createContext<Locale>('en');

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <Ctx.Provider value={locale}>{children}</Ctx.Provider>;
}

export function useLocale(): Locale {
  return useContext(Ctx);
}

export function useT() {
  const locale = useLocale();
  return (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars);
}
