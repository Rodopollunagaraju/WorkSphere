// Small API client used by the e2e tests and the failure drills (Node 20: global fetch).
const BASE = process.env.BASE_URL || 'http://localhost:3000/api';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}
// Retry a check until it returns something truthy: for asserting on eventually consistent state.
async function eventually(fn, { timeout = 20000, every = 500 } = {}) {
  const end = Date.now() + timeout; let lastErr;
  while (Date.now() < end) { try { const r = await fn(); if (r) return r; } catch (e) { lastErr = e; } await sleep(every); }
  throw lastErr || new Error(`condition not met within ${timeout}ms`);
}
const uniq = (p) => `${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function newUser(label = 'user') {
  const email = `${uniq(label)}@example.com`;
  const r = await call('POST', '/auth/register', { body: { name: label, email, password: 'password123' } });
  if (r.status !== 201) throw new Error(`register failed: ${r.status} ${JSON.stringify(r.data)}`);
  return { email, name: label, userId: r.data.user.id, userToken: r.data.accessToken, refreshToken: r.data.refreshToken };
}
// Creates an org owned by `user` and returns an org-scoped token. plan: 'FREE' | 'PRO' | { plan, rateLimit }
async function newOrg(user, name = 'Acme', plan = 'FREE') {
  const o = await call('POST', '/auth/organizations', { token: user.userToken, body: { name } });
  const orgId = o.data.organization._id;
  const sw = await call('POST', '/auth/switch-org', { token: user.userToken, body: { orgId } });
  const token = sw.data.accessToken;
  if (plan !== 'FREE') { const body = typeof plan === 'string' ? { plan } : plan; await call('PATCH', '/auth/organizations/plan', { token, body }); }
  return { orgId, token, owner: user };
}
// Invites a brand-new user into the org with the given role; returns their org-scoped token.
async function addMember(org, role = 'MEMBER', label = 'member') {
  const u = await newUser(label);
  const inv = await call('POST', '/auth/invites', { token: org.token, body: { email: u.email, role } });
  if (inv.status !== 201) throw new Error(`invite failed: ${inv.status} ${JSON.stringify(inv.data)}`);
  const acc = await call('POST', '/auth/invites/accept', { token: u.userToken, body: { token: inv.data.inviteToken } });
  if (acc.status !== 201) throw new Error(`accept failed: ${acc.status} ${JSON.stringify(acc.data)}`);
  const sw = await call('POST', '/auth/switch-org', { token: u.userToken, body: { orgId: org.orgId } });
  return { ...u, token: sw.data.accessToken };
}
async function newProject(org, name = 'Roadmap', members = []) {
  const r = await call('POST', '/projects', { token: org.token, body: { name, members } });
  if (r.status !== 201) throw new Error(`project failed: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.project;
}
module.exports = { BASE, call, eventually, sleep, uniq, newUser, newOrg, addMember, newProject };
