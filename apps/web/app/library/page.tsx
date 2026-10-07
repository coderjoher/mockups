'use client';
import { MockupGrid } from '@/components/MockupGrid';
import { useT } from '@/lib/I18nProvider';

export default function LibraryPage() {
  const t = useT();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t('library.title')}</h1>
      <MockupGrid />
    </div>
  );
}
