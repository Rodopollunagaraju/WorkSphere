import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, tokens, decode, refreshSession } from './api';

const ROLES = ['VIEWER', 'MEMBER', 'ADMIN', 'OWNER'];
const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const qc = useQueryClient();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState(null);
  const [orgs, setOrgs] = useState([]);
  const [claims, setClaims] = useState({});
  const [token, setToken] = useState(null);

  const apply = useCallback((accessToken) => { tokens.set(accessToken); setToken(accessToken); setClaims(decode(accessToken)); }, []);
  const loadOrgs = useCallback(async () => { const { data } = await api.get('/auth/organizations'); setOrgs(data.organizations); return data.organizations; }, []);

  const switchOrg = useCallback(async (orgId) => {
    const { data } = await api.post('/auth/switch-org', { orgId });
    tokens.setOrg(orgId); apply(data.accessToken); qc.clear();
  }, [apply, qc]);

  const enter = useCallback(async (data) => {
    tokens.setRefresh(data.refreshToken); apply(data.accessToken);
    const list = await loadOrgs();
    const pick = list.find((o) => o.id === tokens.org()) || list[0];
    if (pick) await switchOrg(pick.id);
  }, [apply, loadOrgs, switchOrg]);

  const logout = useCallback(async () => {
    try { if (tokens.refresh()) await api.post('/auth/logout', { refreshToken: tokens.refresh() }); } catch { /* already gone */ }
    tokens.set(null); tokens.setRefresh(null); tokens.setOrg(null);
    setUser(null); setOrgs([]); setClaims({}); setToken(null); qc.clear();
  }, [qc]);

  // Restore the session on page load from the refresh token.
  useEffect(() => {
    (async () => {
      try {
        apply(await refreshSession());
        const { data } = await api.get('/auth/me'); setUser(data.user); await loadOrgs();
      } catch { tokens.setRefresh(null); }
      setReady(true);
    })();
    const on = () => logout(); window.addEventListener('ws:logout', on);
    return () => window.removeEventListener('ws:logout', on);
  }, [apply, loadOrgs, logout]);

  const value = useMemo(() => ({
    ready, user, orgs, token, orgId: claims.orgId || null, role: claims.role || null,
    can: (min) => ROLES.indexOf(claims.role) >= ROLES.indexOf(min), // UI hint only; the server enforces
    login: async (email, password) => { const { data } = await api.post('/auth/login', { email, password }); setUser(data.user); await enter(data); },
    register: async (name, email, password) => { const { data } = await api.post('/auth/register', { name, email, password }); setUser(data.user); await enter(data); },
    createOrg: async (name) => { const { data } = await api.post('/auth/organizations', { name }); await loadOrgs(); await switchOrg(data.organization._id); },
    switchOrg, logout, reloadOrgs: loadOrgs,
  }), [ready, user, orgs, token, claims, enter, loadOrgs, switchOrg, logout]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
