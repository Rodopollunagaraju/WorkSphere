import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';
import { toast } from '../toast';

export default function Projects() {
  const { orgId, can } = useAuth(); const qc = useQueryClient();
  const [status, setStatus] = useState('ACTIVE'); const [f, setF] = useState({ name: '', description: '', deadline: '' });
  const { data, isLoading } = useQuery({ queryKey: ['projects', status], enabled: !!orgId, queryFn: async () => (await api.get(`/projects?status=${status}&limit=50`)).data });
  const create = useMutation({
    mutationFn: () => api.post('/projects', { name: f.name, description: f.description || undefined, deadline: f.deadline ? new Date(f.deadline).toISOString() : undefined }),
    onSuccess: () => { setF({ name: '', description: '', deadline: '' }); qc.invalidateQueries({ queryKey: ['projects'] }); },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const archive = useMutation({ mutationFn: (id) => api.post(`/projects/${id}/archive`), onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }), onError: (e) => toast(errorMessage(e), 'error') });

  if (!orgId) return <p className="card">Create an organization (top right) to get started.</p>;
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <select aria-label="Status filter" className="input w-36" value={status} onChange={(e) => setStatus(e.target.value)}><option value="ACTIVE">Active</option><option value="ARCHIVED">Archived</option></select>
      </div>
      {can('ADMIN') && (
        <form className="card flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <label className="text-sm">Name<input className="input mt-1" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></label>
          <label className="flex-1 text-sm">Description<input className="input mt-1" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
          <label className="text-sm">Deadline<input className="input mt-1" type="date" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></label>
          <button className="btn" disabled={create.isPending}>Create project</button>
        </form>
      )}
      {isLoading ? <p>Loading…</p> : !data?.items?.length ? <p className="text-slate-500">No projects here yet.{can('ADMIN') ? '' : ' Ask an admin to add you to one.'}</p> : (
        <div className="grid gap-4 md:grid-cols-3">
          {data.items.map((p) => (
            <div key={p._id} className="card">
              <Link to={`/projects/${p._id}`} className="text-lg font-semibold text-indigo-700">{p.name}</Link>
              <p className="mt-1 text-sm text-slate-600">{p.description}</p>
              <p className="mt-2 text-xs text-slate-500">{p.members.length} member(s){p.deadline ? ` · due ${new Date(p.deadline).toLocaleDateString()}` : ''}</p>
              {can('ADMIN') && p.status === 'ACTIVE' && <button className="btn-ghost mt-3" onClick={() => archive.mutate(p._id)}>Archive</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
