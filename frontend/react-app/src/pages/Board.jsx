import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';
import { useMembers } from '../hooks';
import { useSocket } from '../socket';
import { toast } from '../toast';
import TaskDrawer from '../components/TaskDrawer';

export const COLUMNS = [['TODO', 'To do'], ['IN_PROGRESS', 'In progress'], ['IN_REVIEW', 'In review'], ['DONE', 'Done']];
const PRIORITY_STYLE = { LOW: 'bg-slate-100', MEDIUM: 'bg-blue-100', HIGH: 'bg-orange-100', URGENT: 'bg-red-100' };
let dragged = null; // id of the card being dragged (avoids DataTransfer quirks)

export default function Board() {
  const { id } = useParams(); const qc = useQueryClient(); const { can } = useAuth();
  const { name, byId } = useMembers(); const { online } = useSocket();
  const [filters, setFilters] = useState({ assignee: '', priority: '' }); const [openId, setOpenId] = useState(null);
  const [draft, setDraft] = useState({ title: '', priority: 'MEDIUM', assignedTo: '', dueDate: '' });

  const project = useQuery({ queryKey: ['project', id], queryFn: async () => (await api.get(`/projects/${id}`)).data.project });
  const tasks = useQuery({ queryKey: ['tasks', id], queryFn: async () => (await api.get(`/tasks?projectId=${id}&limit=100`)).data.items });
  const presence = useQuery({ queryKey: ['presence'], queryFn: async () => (await api.get('/notifications/presence')).data.online });
  const isOnline = (uid) => online.has(uid) || (presence.data || []).includes(uid);
  const writable = can('MEMBER') && project.data?.status === 'ACTIVE';

  const move = useMutation({
    mutationFn: ({ task, status }) => api.post(`/tasks/${task._id}/status`, { status, version: task.version }),
    onMutate: async ({ task, status }) => { // optimistic update
      await qc.cancelQueries({ queryKey: ['tasks', id] });
      const prev = qc.getQueryData(['tasks', id]);
      qc.setQueryData(['tasks', id], prev.map((t) => (t._id === task._id ? { ...t, status, version: t.version + 1 } : t)));
      return { prev };
    },
    onError: (e, _v, ctx) => {
      qc.setQueryData(['tasks', id], ctx.prev);
      toast(e.response?.status === 409 ? 'Someone else changed this task. Board refreshed, try again.' : errorMessage(e), 'error');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['tasks', id] }),
  });
  const create = useMutation({
    mutationFn: () => api.post('/tasks', { projectId: id, title: draft.title, priority: draft.priority, assignedTo: draft.assignedTo || undefined, dueDate: draft.dueDate ? new Date(draft.dueDate).toISOString() : undefined }),
    onSuccess: () => { setDraft({ title: '', priority: 'MEDIUM', assignedTo: '', dueDate: '' }); qc.invalidateQueries({ queryKey: ['tasks', id] }); },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const visible = (tasks.data || []).filter((t) => (!filters.assignee || t.assignedTo === filters.assignee) && (!filters.priority || t.priority === filters.priority));
  const drop = (status) => { const task = (tasks.data || []).find((t) => t._id === dragged); dragged = null; if (task && task.status !== status && writable) move.mutate({ task, status }); };

  if (project.isError) return <p className="card text-red-600">{errorMessage(project.error)}</p>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{project.data?.name}</h1>
        {project.data?.status === 'ARCHIVED' && <span className="rounded bg-yellow-100 px-2 py-0.5 text-xs">Archived (read-only)</span>}
        <div className="ml-auto flex items-center gap-1" aria-label="Project members">
          {(project.data?.members || []).map((uid) => (
            <span key={uid} title={`${name(uid)}${isOnline(uid) ? ' (online)' : ''}`} className="relative inline-flex h-7 w-7 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold">
              {name(uid).slice(0, 1).toUpperCase()}<span data-testid={isOnline(uid) ? 'online-dot' : undefined} className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-white ${isOnline(uid) ? 'bg-green-500' : 'bg-slate-300'}`} />
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <select aria-label="Filter by assignee" className="input w-44" value={filters.assignee} onChange={(e) => setFilters({ ...filters, assignee: e.target.value })}>
          <option value="">All assignees</option>{(project.data?.members || []).map((uid) => <option key={uid} value={uid}>{name(uid)}</option>)}
        </select>
        <select aria-label="Filter by priority" className="input w-40" value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })}>
          <option value="">All priorities</option>{['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((p) => <option key={p}>{p}</option>)}
        </select>
        {writable && (
          <form className="flex flex-1 flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
            <input aria-label="New task title" className="input min-w-48 flex-1" placeholder="New task title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} required />
            <select aria-label="New task priority" className="input w-28" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })}>{['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((p) => <option key={p}>{p}</option>)}</select>
            <select aria-label="New task assignee" className="input w-40" value={draft.assignedTo} onChange={(e) => setDraft({ ...draft, assignedTo: e.target.value })}><option value="">Unassigned</option>{(project.data?.members || []).map((uid) => <option key={uid} value={uid}>{name(uid)}</option>)}</select>
            <input aria-label="New task due date" className="input w-40" type="date" value={draft.dueDate} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })} />
            <button className="btn" disabled={create.isPending}>Add task</button>
          </form>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {COLUMNS.map(([status, label]) => {
          const col = visible.filter((t) => t.status === status);
          return (
            <section key={status} aria-label={label} data-testid={`col-${status}`} className="min-h-48 rounded-lg bg-slate-100 p-3" onDragOver={(e) => e.preventDefault()} onDrop={() => drop(status)}>
              <h2 className="mb-2 flex justify-between text-sm font-semibold">{label}<span className="text-slate-500">{col.length}</span></h2>
              <div className="space-y-2">
                {col.map((t) => (
                  <article key={t._id} draggable={writable} onDragStart={() => { dragged = t._id; }} onClick={() => setOpenId(t._id)} className="cursor-pointer card p-3 text-sm hover:border-indigo-300">
                    <div className="font-medium">{t.title}</div>
                    <div className="mt-2 flex items-center gap-2 text-xs">
                      <span className={`rounded px-1.5 py-0.5 ${PRIORITY_STYLE[t.priority]}`}>{t.priority}</span>
                      <span className="text-slate-500">{t.assignedTo ? name(t.assignedTo) : 'Unassigned'}</span>
                      {t.dueDate && <span className={new Date(t.dueDate) < new Date() && t.status !== 'DONE' ? 'text-red-600' : 'text-slate-500'}>{new Date(t.dueDate).toLocaleDateString()}</span>}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      {openId && <TaskDrawer taskId={openId} project={project.data} members={byId} name={name} onClose={() => setOpenId(null)} writable={writable} />}
    </div>
  );
}
