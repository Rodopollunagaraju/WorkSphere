import { useState } from 'react';
import { useAuth } from '../auth';
import { errorMessage } from '../api';
import { toast } from '../toast';

export default function OrgSwitcher() {
  const { orgs, orgId, switchOrg, createOrg } = useAuth(); const [name, setName] = useState('');
  const create = async () => { try { await createOrg(name); setName(''); } catch (e) { toast(errorMessage(e), 'error'); } };
  if (!orgs.length) return (
    <div className="flex gap-2"><input className="input w-48" placeholder="New organization name" value={name} onChange={(e) => setName(e.target.value)} /><button className="btn" onClick={create} disabled={name.length < 2}>Create</button></div>
  );
  return (
    <div className="flex items-center gap-2">
      <select aria-label="Organization" className="input w-48" value={orgId || ''} onChange={(e) => switchOrg(e.target.value)}>
        {orgs.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.role.toLowerCase()})</option>)}
      </select>
      <input className="input w-36" placeholder="New org" value={name} onChange={(e) => setName(e.target.value)} />
      <button className="btn-ghost" onClick={create} disabled={name.length < 2}>+</button>
    </div>
  );
}
