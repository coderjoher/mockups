'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Checklist } from './Checklist';
import { Gallery } from './Gallery';
import { MockupStep } from './MockupStep';
import { SharePanel } from './SharePanel';

export function ProjectClient({ id }: { id: string }) {
  const [project, setProject] = useState<any>(null);
  const [step, setStep] = useState<'pages' | 'captures' | 'mockups'>('pages');
  useEffect(() => {
    api(`/projects/${id}`).then((r) => setProject(r.project), () => (location.href = '/login'));
  }, [id, step]); // refreshed per step: brand colours arrive with the Home capture
  if (!project) return null;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{project.title}</h1>
        <p className="muted" dir="ltr">{project.root_url}</p>
        <SharePanel projectId={id} />
      </div>
      {step === 'pages' && <Checklist projectId={id} onNext={() => setStep('captures')} />}
      {step === 'captures' && <Gallery projectId={id} onBack={() => setStep('pages')} onNext={() => setStep('mockups')} />}
      {step === 'mockups' && <MockupStep projectId={id} onBack={() => setStep('captures')} brand={project.brand_colors ?? []} />}
    </div>
  );
}
