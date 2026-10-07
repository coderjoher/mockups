'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Checklist } from './Checklist';
import { Gallery } from './Gallery';

export function ProjectClient({ id }: { id: string }) {
  const [project, setProject] = useState<any>(null);
  const [step, setStep] = useState<'pages' | 'captures' | 'mockups'>('pages');
  useEffect(() => {
    api(`/projects/${id}`).then((r) => setProject(r.project), () => (location.href = '/login'));
  }, [id]);
  if (!project) return null;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{project.title}</h1>
        <p className="muted" dir="ltr">{project.root_url}</p>
      </div>
      {step === 'pages' && <Checklist projectId={id} onNext={() => setStep('captures')} />}
      {step === 'captures' && <Gallery projectId={id} onBack={() => setStep('pages')} onNext={() => setStep('mockups')} />}
    </div>
  );
}
