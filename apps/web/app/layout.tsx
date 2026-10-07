import './globals.css';
import { direction, translate } from '@/lib/i18n';
import { currentLocale } from '@/lib/locale-server';
import { I18nProvider } from '@/lib/I18nProvider';
import { Nav } from './Nav';

export const metadata = { title: 'Mockup Generator' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await currentLocale();
  return (
    <html lang={locale} dir={direction(locale)}>
      <body className="min-h-screen">
        <I18nProvider locale={locale}>
          <Nav appName={translate(locale, 'app.name')} />
          <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        </I18nProvider>
      </body>
    </html>
  );
}
