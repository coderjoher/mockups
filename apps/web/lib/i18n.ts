import en from '../messages/en.json';
import ar from '../messages/ar.json';

export type Locale = 'en' | 'ar';
export const LOCALES: Locale[] = ['en', 'ar'];
export type Messages = typeof en;
const dictionaries: Record<Locale, Messages> = { en, ar };

export function normaliseLocale(value: string | undefined | null): Locale {
  return value === 'ar' ? 'ar' : 'en';
}

export function direction(locale: Locale): 'rtl' | 'ltr' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

export function messages(locale: Locale): Messages {
  return dictionaries[locale];
}

/** Looks up "a.b.c" and fills {name} placeholders. Falls back to English, then to the key. */
export function translate(locale: Locale, key: string, vars: Record<string, string | number> = {}): string {
  const find = (dict: any) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), dict);
  const raw = find(dictionaries[locale]) ?? find(dictionaries.en) ?? key;
  return String(raw).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}
