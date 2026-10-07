import { cookies } from 'next/headers';
import { normaliseLocale, type Locale } from './i18n';

export async function currentLocale(): Promise<Locale> {
  return normaliseLocale((await cookies()).get('locale')?.value);
}
