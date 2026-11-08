import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, tokens } from '../api';
import { toast } from '../toast';

const MENTION = /@([a-f0-9]{24})/g;

export default function TaskDrawer({ taskId, project, name, onClose, writable }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(null); const [conflict, setConflict] = useState(false);
  const [comment, setComment] = useState(''); const [progress, setProgress] = useState(null);
  const q = (key, path, sel) => useQuery({ queryKey: [key, taskId], queryFn: async () => (await api.get(path)).data[sel] }); // eslint-disable-line react-hooks/rules-of-hooks
  const task = useQuery({ queryKey: ['task', taskId], queryFn: async () => (await api.get(`/tasks/${taskId}`)).data.task });
  const comments = q('comments', `/tasks/${taskId}/comments`, 'comments');
  const history = q('history', `/tasks/${taskId}/history`, 'history');
  const files = q('attachments', `/tasks/${taskId}/attachments`, 'attachments');

  useEffect(() => { if (task.data) { setForm({ title: task.data.title, description: task.data.description || '', priority: task.data.priority, dueDate: task.data.dueDate ? task.data.dueDate.slice(0, 10) : '' }); setConflict(false); } }, [task.data]);
  const refreshAll = () => ['task', 'tasks', 'history', 'comments', 'attachments'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const save = useMutation({
    mutationFn: () => api.patch(`/tasks/${taskId}`, { version: task.data.version, title: form.title, description: form.description, priority: form.priority, dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null }),
    onSuccess: () => { toast('Saved'); refreshAll(); },
    onError: (e) => { if (e.response?.status === 409) setConflict(true); else toast(errorMessage(e), 'error'); },
  });
  const assign = useMutation({ mutationFn: (assignedTo) => api.post(`/tasks/${taskId}/assign`, { assignedTo: assignedTo || null }), onSuccess: refreshAll, onError: (e) => toast(errorMessage(e), 'error') });
  const remove = useMutation({ mutationFn: () => api.delete(`/tasks/${taskId}`), onSuccess: () => { refreshAll(); onClose(); }, onError: (e) => toast(errorMessage(e), 'error') });
  const addComment = useMutation({ mutationFn: () => api.post(`/tasks/${taskId}/comments`, { body: comment }), onSuccess: () => { setComment(''); refreshAll(); }, onError: (e) => toast(errorMessage(e), 'error') });

  // Presigned upload straight to object storage, with progress, then confirm.
  async function upload(file) {
    try {
      const { data } = await api.post(`/tasks/${taskId}/attachments/presign`, { fileName: file.name, contentType: file.type || 'application/octet-stream', size: file.size });
      await new Promise((resolve, reject) => {
        const x = new XMLHttpRequest(); x.open('PUT', data.uploadUrl); x.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        x.upload.onprogress = (e) => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100));
        x.onload = () => (x.status < 300 ? resolve() : reject(new Error(`Upload failed (${x.status})`))); x.onerror = () => reject(new Error('Upload failed'));
        x.send(file);
      });
      await api.post(`/tasks/${taskId}/attachments/${data.attachmentId}/confirm`);
      qc.invalidateQueries({ queryKey: ['attachments', taskId] }); toast('Attachment uploaded');
    } catch (e) { toast(errorMessage(e), 'error'); } finally { setProgress(null); }
  }
  async function download(att) { const { data } = await api.get(`/tasks/${taskId}/attachments/${att._id}/download`); window.open(data.downloadUrl, '_blank'); }
  const render = (body) => body.replace(MENTION, (_, id) => `@${name(id)}`);
  const t = task.data; void tokens;

  return (
    <aside role="dialog" aria-label="Task details" className="fixed inset-y-0 right-0 z-30 w-full max-w-xl overflow-auto border-l bg-white p-5 shadow-xl">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-semibold">Task</h2><button className="btn-ghost" onClick={onClose}>Close</button></div>
      {!t || !form ? <p>Loading…</p> : (
        <div className="space-y-5">
          {conflict && <div role="alert" className="rounded bg-yellow-50 p-3 text-sm">Someone else edited this task. <button className="font-medium text-indigo-700 underline" onClick={() => task.refetch()}>Reload their version</button> (your edits will be replaced).</div>}
          <fieldset disabled={!writable} className="space-y-3">
            <label className="block text-sm">Title<input className="input mt-1" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
            <label className="block text-sm">Description<textarea className="input mt-1" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
            <div className="flex gap-3">
              <label className="flex-1 text-sm">Priority<select className="input mt-1" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>{['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((p) => <option key={p}>{p}</option>)}</select></label>
              <label className="flex-1 text-sm">Due date<input className="input mt-1" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></label>
              <label className="flex-1 text-sm">Assignee<select aria-label="Assignee" className="input mt-1" value={t.assignedTo || ''} onChange={(e) => assign.mutate(e.target.value)}><option value="">Unassigned</option>{(project?.members || []).map((uid) => <option key={uid} value={uid}>{name(uid)}</option>)}</select></label>
            </div>
            <div className="flex gap-2"><button className="btn" onClick={() => save.mutate()} disabled={save.isPending}>Save changes</button><button className="btn-ghost text-red-600" onClick={() => window.confirm('Delete this task?') && remove.mutate()}>Delete</button></div>
          </fieldset>

          <section><h3 className="mb-2 text-sm font-semibold">Attachments</h3>
            {(files.data || []).map((a) => <button key={a._id} className="mr-2 text-sm text-indigo-700 underline" onClick={() => download(a)}>{a.fileName}</button>)}
            {writable && <div className="mt-2"><input aria-label="Upload attachment" type="file" onChange={(e) => e.target.files[0] && upload(e.target.files[0])} />{progress !== null && <div className="mt-1 h-2 w-full rounded bg-slate-200"><div className="h-2 rounded bg-indigo-600" style={{ width: `${progress}%` }} /></div>}</div>}
          </section>

          <section><h3 className="mb-2 text-sm font-semibold">Comments</h3>
            <div className="space-y-2">{(comments.data || []).map((c) => <div key={c._id} className="rounded bg-slate-50 p-2 text-sm"><b>{name(c.authorId)}</b> <span className="text-xs text-slate-400">{new Date(c.createdAt).toLocaleString()}</span><p>{render(c.body)}</p></div>)}</div>
            {writable && (
              <div className="mt-2 space-y-2">
                <textarea aria-label="New comment" className="input" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Write a comment…" />
                <div className="flex gap-2">
                  <select aria-label="Mention someone" className="input w-44" value="" onChange={(e) => e.target.value && setComment((c) => `${c}@${e.target.value} `)}><option value="">@ mention…</option>{(project?.members || []).map((uid) => <option key={uid} value={uid}>{name(uid)}</option>)}</select>
                  <button className="btn" onClick={() => addComment.mutate()} disabled={!comment.trim()}>Comment</button>
                </div>
              </div>
            )}
          </section>

          <section><h3 className="mb-2 text-sm font-semibold">History</h3>
            <ol className="space-y-1 border-l pl-3 text-xs text-slate-600">
              {(history.data || []).map((h) => <li key={h._id}><b>{name(h.actorId)}</b> {h.field === 'created' ? 'created the task' : h.field === 'deleted' ? 'deleted the task' : <>changed <b>{h.field}</b> from {String(h.field === 'assignedTo' ? name(h.oldValue) : h.oldValue ?? '–')} to {String(h.field === 'assignedTo' ? name(h.newValue) : h.newValue ?? '–')}</>} <span className="text-slate-400">{new Date(h.createdAt).toLocaleString()}</span></li>)}
            </ol>
          </section>
        </div>
      )}
    </aside>
  );
}
