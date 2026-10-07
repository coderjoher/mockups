import { SharedGallery } from './SharedGallery';

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SharedGallery token={token} />;
}
