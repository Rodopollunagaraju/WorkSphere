import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api';
import { useAuth } from '../auth';
import { useMembers } from '../hooks';

const COLORS = { TODO: '#94a3b8', IN_PROGRESS: '#3b82f6', IN_REVIEW: '#f59e0b', DONE: '#22c55e' };

// Reads ONLY from the analytics read model (CQRS query side). Data is eventually consistent, so we show its age.
export default function Dashboard() {
  const { orgId } = useAuth(); const { name } = useMembers();
  const opts = { enabled: !!orgId, refetchInterval: 5000 };
  const overview = useQuery({ queryKey: ['a-overview'], queryFn: async () => (await api.get('/analytics/overview')).data, ...opts });
  const workload = useQuery({ queryKey: ['a-workload'], queryFn: async () => (await api.get('/analytics/workload')).data, ...opts });
  const overdue = useQuery({ queryKey: ['a-overdue'], queryFn: async () => (await api.get('/analytics/overdue')).data, ...opts });
  const activity = useQuery({ queryKey: ['a-activity'], queryFn: async () => (await api.get('/analytics/activity?limit=15')).data, ...opts });

  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const updated = overview.data?.lastUpdatedAt ? Math.max(0, Math.round((now - new Date(overview.data.lastUpdatedAt)) / 1000)) : null;
  const projects = overview.data?.projects || [];
  const chart = projects.map((p) => ({ name: p.name || p.projectId.slice(0, 6), ...p.byStatus }));

  if (!orgId) return <p className="card">Select an organization first.</p>;
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <span className="text-xs text-slate-500" aria-live="polite">
          {overview.isFetching ? 'refreshing…' : updated === null ? 'no activity yet' : `Updated ${updated}s ago`} · eventually consistent
        </span>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        {[['Total tasks', projects.reduce((n, p) => n + p.total, 0)], ['Completed', projects.reduce((n, p) => n + p.completed, 0)], ['Pending', projects.reduce((n, p) => n + p.pending, 0)], ['Overdue', projects.reduce((n, p) => n + p.overdue, 0)]].map(([l, v]) => (
          <div key={l} className="card"><div className="text-sm text-slate-500">{l}</div><div className="text-3xl font-semibold" data-testid={`kpi-${l}`}>{v}</div></div>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card"><h2 className="mb-2 font-semibold">Status by project</h2>
          <div style={{ height: 260 }}><ResponsiveContainer><BarChart data={chart}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis allowDecimals={false} /><Tooltip /><Legend />{Object.keys(COLORS).map((s) => <Bar key={s} dataKey={s} stackId="a" fill={COLORS[s]} />)}</BarChart></ResponsiveContainer></div>
        </div>
        <div className="card"><h2 className="mb-2 font-semibold">Workload per member (open tasks)</h2>
          <div style={{ height: 260 }}><ResponsiveContainer><BarChart data={(workload.data?.workload || []).map((w) => ({ ...w, member: name(w.userId) }))}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="member" /><YAxis allowDecimals={false} /><Tooltip /><Legend /><Bar dataKey="open" fill="#6366f1" /><Bar dataKey="overdue" fill="#ef4444" /></BarChart></ResponsiveContainer></div>
        </div>
      </div>
      <div className="card"><h2 className="mb-2 font-semibold">Project completion</h2>
        {projects.map((p) => (
          <div key={p.projectId} className="mb-2 text-sm"><div className="flex justify-between"><span>{p.name}</span><span>{p.completionPct}%</span></div><div className="h-2 rounded bg-slate-200"><div className="h-2 rounded bg-green-500" style={{ width: `${p.completionPct}%` }} /></div></div>
        ))}
        {!projects.length && <p className="text-sm text-slate-500">No projects yet.</p>}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card"><h2 className="mb-2 font-semibold">Overdue tasks</h2>
          {!overdue.data?.items?.length ? <p className="text-sm text-slate-500">Nothing overdue 🎉</p> : overdue.data.items.map((t) => <div key={t._id} className="border-b py-1 text-sm">{t.title} <span className="text-red-600">· due {new Date(t.dueDate).toLocaleDateString()}</span> <span className="text-slate-500">· {name(t.assignedTo)}</span></div>)}
        </div>
        <div className="card"><h2 className="mb-2 font-semibold">Activity</h2>
          {(activity.data?.items || []).map((a) => <div key={a._id} className="border-b py-1 text-sm"><b>{name(a.actorId)}</b> {a.summary} <span className="text-xs text-slate-400">{new Date(a.occurredAt).toLocaleTimeString()}</span></div>)}
        </div>
      </div>
    </div>
  );
}
