import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';
import { useMembers } from '../hooks';
import { toast } from '../toast';

export default function Members() {
  const { can, user, orgId, orgs } = useAuth(); const qc = useQueryClient(); const { list } = useMembers();
  const [invite, setInvite] = useState({ email: '', role: 'MEMBER' }); const [link, setLink] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['members'] });
  const fail = (e) => toast(errorMessage(e), 'error');
  const send = useMutation({ mutationFn: async () => (await api.post('/auth/invites', invite)).data, onSuccess: (d) => { setLink(`${window.location.origin}/accept-invite?token=${d.inviteToken}`); toast('Invite sent (also emailed to Mailpit)'); }, onError: fail });
  const setRole = useMutation({ mutationFn: ({ id, role }) => api.patch(`/auth/members/${id}/role`, { role }), onSuccess: refresh, onError: fail });
  const remove = useMutation({ mutationFn: (id) => api.delete(`/auth/members/${id}`), onSuccess: refresh, onError: fail });
  const plan = useMutation({ mutationFn: (p) => api.patch('/auth/organizations/plan', { plan: p }), onSuccess: () => toast('Plan updated: rate limits apply immediately'), onError: fail });
  const current = orgs.find((o) => o.id === orgId);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Members</h1>
      {can('ADMIN') && (
        <form className="card flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
          <label className="text-sm">Email<input className="input mt-1" type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} required /></label>
          <label className="text-sm">Role<select className="input mt-1" value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}><option>VIEWER</option><option>MEMBER</option>{can('OWNER') && <option>ADMIN</option>}</select></label>
          <button className="btn">Invite</button>
          {link && <p className="w-full break-all text-xs text-slate-500">Invite link: {link}</p>}
        </form>
      )}
      <div className="card divide-y">
        {list.map((m) => (
          <div key={m.userId} className="flex items-center gap-3 py-2 text-sm">
            <span className="flex-1">{m.name} <span className="text-slate-400">{m.email}</span></span>
            {can('ADMIN') && m.email !== user?.email
              ? <select aria-label={`Role of ${m.name}`} className="input w-32" value={m.role} onChange={(e) => setRole.mutate({ id: m.userId, role: e.target.value })}>{['VIEWER', 'MEMBER', 'ADMIN', 'OWNER'].map((r) => <option key={r}>{r}</option>)}</select>
              : <span className="rounded bg-slate-100 px-2 py-0.5">{m.role}</span>}
            {can('ADMIN') && m.email !== user?.email && <button className="btn-ghost" onClick={() => remove.mutate(m.userId)}>Remove</button>}
          </div>
        ))}
      </div>
      {can('OWNER') && (
        <div className="card text-sm">Plan for <b>{current?.name}</b>: current <b>{current?.plan}</b>. Rate limits: Free 100/min, Pro 500/min.
          <div className="mt-2 flex gap-2">{['FREE', 'PRO'].map((p) => <button key={p} className="btn-ghost" onClick={() => plan.mutate(p)}>Switch to {p}</button>)}</div>
        </div>
      )}
    </div>
  );
}
