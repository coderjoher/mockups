import { MockupEditor } from '@/components/MockupEditor';

export default async function EditMockupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MockupEditor id={id} />;
}
