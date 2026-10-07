import { translate } from '@/lib/i18n';
import { currentLocale } from '@/lib/locale-server';

export default async function Home() {
  const locale = await currentLocale();
  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-bold">{translate(locale, 'app.name')}</h1>
      <p className="muted">{translate(locale, 'app.tagline')}</p>
    </section>
  );
}
