'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Checklist } from './Checklist';

export function ProjectClient({ id }: { id: string }) {
  const [project, setProject] = useState<any>(null);
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
      <Checklist projectId={id} onNext={() => {}} />
    </div>
  );
}
