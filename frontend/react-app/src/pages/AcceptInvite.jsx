import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';

export default function AcceptInvite() {
  const [params] = useSearchParams(); const nav = useNavigate(); const { reloadOrgs, switchOrg } = useAuth();
  const [msg, setMsg] = useState('Accepting invitation…');
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.post('/auth/invites/accept', { token: params.get('token') || '' });
        await reloadOrgs(); await switchOrg(data.organizationId); nav('/', { replace: true });
      } catch (e) { setMsg(errorMessage(e)); }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <p className="card">{msg}</p>;
}
