// Shared helpers: creates an isolated org + project through the real API and returns tokens/ids.
import http from 'k6/http';
import { check, fail } from 'k6';

export const BASE = __ENV.BASE_URL || 'http://localhost:3000/api';
const json = { headers: { 'Content-Type': 'application/json' } };
const auth = (t) => ({ headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` } });
export const withAuth = auth;

export function bootstrap({ plan = 'FREE', rateLimit } = {}) {
  const email = `k6-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const reg = http.post(`${BASE}/auth/register`, JSON.stringify({ name: 'k6 user', email, password: 'password123' }), json);
  if (reg.status !== 201) fail(`register failed: ${reg.status} ${reg.body}`);
  const org = http.post(`${BASE}/auth/organizations`, JSON.stringify({ name: 'k6 org' }), auth(reg.json('accessToken')));
  const orgId = org.json('organization._id');
  const sw = http.post(`${BASE}/auth/switch-org`, JSON.stringify({ orgId }), auth(reg.json('accessToken')));
  const token = sw.json('accessToken');
  if (plan !== 'FREE') http.patch(`${BASE}/auth/organizations/plan`, JSON.stringify({ plan, rateLimit }), auth(token));
  const proj = http.post(`${BASE}/projects`, JSON.stringify({ name: 'Load test project' }), auth(token));
  if (!check(proj, { 'project created': (r) => r.status === 201 })) fail(`project failed: ${proj.body}`);
  const userId = JSON.parse(atob(token.split('.')[1])).sub;
  return { email, token, orgId, userId, projectId: proj.json('project._id') };
}
export const atob = (s) => { // k6 has no atob in older versions; tiny decoder
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let o = ''; let b = 0; let n = 0;
  for (const ch of s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')) { b = (b << 6) | c.indexOf(ch); n += 6; if (n >= 8) { n -= 8; o += String.fromCharCode((b >> n) & 255); } }
  return o;
};
