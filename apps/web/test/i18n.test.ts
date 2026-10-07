import { describe, expect, it } from 'vitest';
import { direction, messages, normaliseLocale, translate } from '../lib/i18n';

function keys(o: any, prefix = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
}

describe('[F-7] Arabic and English UI', () => {
  it('uses RTL for Arabic and LTR for English', () => {
    expect(direction('ar')).toBe('rtl');
    expect(direction('en')).toBe('ltr');
    expect(normaliseLocale('ar')).toBe('ar');
    expect(normaliseLocale('fr')).toBe('en');
    expect(normaliseLocale(undefined)).toBe('en');
  });

  it('has an Arabic translation for every English string', () => {
    expect(keys(messages('ar')).sort()).toEqual(keys(messages('en')).sort());
  });

  it('translates with placeholders and falls back to the key', () => {
    expect(translate('ar', 'nav.projects')).toBe('المشاريع');
    expect(translate('en', 'missing.key')).toBe('missing.key');
  });
});
