'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export function ProjectClient({ id }: { id: string }) {
  const [project, setProject] = useState<any>(null);
  useEffect(() => {
    api(`/projects/${id}`).then((r) => setProject(r.project));
  }, [id]);
  if (!project) return null;
  return (
    <div>
      <h1 className="text-2xl font-bold">{project.title}</h1>
      <p className="muted" dir="ltr">{project.root_url}</p>
    </div>
  );
}
