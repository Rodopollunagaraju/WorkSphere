import axios from 'axios';

// Access token lives in memory only; the refresh token is kept in localStorage (trade-off: XSS risk vs. survives reload).
let accessToken = null;
export const tokens = {
  set: (t) => { accessToken = t; },
  get: () => accessToken,
  refresh: () => localStorage.getItem('ws_refresh'),
  setRefresh: (r) => (r ? localStorage.setItem('ws_refresh', r) : localStorage.removeItem('ws_refresh')),
  org: () => localStorage.getItem('ws_org'),
  setOrg: (o) => (o ? localStorage.setItem('ws_org', o) : localStorage.removeItem('ws_org')),
};
export const decode = (t) => { try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return {}; } };
export const errorMessage = (e) => e?.response?.data?.error?.message || e?.message || 'Something went wrong';

export const api = axios.create({ baseURL: '/api' });
api.interceptors.request.use((cfg) => { if (accessToken) cfg.headers.Authorization = `Bearer ${accessToken}`; return cfg; });

// Single-flight refresh: concurrent 401s share one rotation (a second use of the same refresh token would revoke the session).
let refreshing = null;
export async function refreshSession() {
  const refreshToken = tokens.refresh();
  if (!refreshToken) throw new Error('no session');
  refreshing = refreshing || axios.post('/api/auth/refresh', { refreshToken, orgId: tokens.org() || undefined })
    .then(({ data }) => { tokens.set(data.accessToken); tokens.setRefresh(data.refreshToken); return data.accessToken; })
    .finally(() => { refreshing = null; });
  return refreshing;
}
api.interceptors.response.use((r) => r, async (err) => {
  const { config, response } = err;
  if (response?.status === 401 && config && !config._retry && !String(config.url).startsWith('/auth/')) {
    config._retry = true;
    try { await refreshSession(); return api(config); } catch { window.dispatchEvent(new Event('ws:logout')); }
  }
  return Promise.reject(err);
});
