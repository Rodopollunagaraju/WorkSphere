const http = require('node:http');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const RedisMock = require('ioredis-mock');
const { createApp } = require('../src/app');

const SECRET = 'test-secret';
let upstream; let url; let seen;
const services = () => ({ auth: url, project: url, task: url, notification: url, analytics: url });

beforeAll(async () => {
  upstream = http.createServer((req, res) => { seen = { url: req.url, headers: req.headers }; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true })); });
  await new Promise((r) => upstream.listen(0, r));
  url = `http://127.0.0.1:${upstream.address().port}`;
});
afterAll(() => upstream.close());
const token = (claims) => jwt.sign(claims, SECRET, { expiresIn: '5m' });
const bearer = (claims) => `Bearer ${token(claims)}`;
const plain = () => createApp({ jwtSecret: SECRET, services: services() });

test('public route passes through and strips spoofed identity headers', async () => {
  await request(plain()).post('/api/auth/login').set('x-user-id', 'attacker').set('x-role', 'OWNER').set('x-internal-token', 'x').send({}).expect(200);
  expect(seen.url).toBe('/auth/login');
  for (const h of ['x-user-id', 'x-role', 'x-internal-token']) expect(seen.headers[h]).toBeUndefined();
});
test('protected routes need a valid token (missing, garbage, forged)', async () => {
  const app = plain();
  await request(app).get('/api/auth/me').expect(401);
  await request(app).get('/api/auth/me').set('Authorization', 'Bearer abc').expect(401);
  await request(app).get('/api/tasks').set('Authorization', `Bearer ${jwt.sign({ sub: 'u1' }, 'other-secret')}`).expect(401);
});
test('verified token injects identity, overriding spoofed headers', async () => {
  await request(plain()).get('/api/auth/me').set('Authorization', bearer({ sub: 'u1', orgId: 'o1', role: 'MEMBER', plan: 'FREE' })).set('x-role', 'OWNER').set('x-org-id', 'victim-org').expect(200);
  expect(seen.headers).toMatchObject({ 'x-user-id': 'u1', 'x-org-id': 'o1', 'x-role': 'MEMBER', 'x-plan': 'FREE' });
  expect(seen.headers['x-correlation-id']).toBeDefined();
});
test('user-level token (no org) sets only the user id', async () => {
  await request(plain()).get('/api/auth/me').set('Authorization', bearer({ sub: 'u2' })).expect(200);
  expect(seen.headers['x-user-id']).toBe('u2'); expect(seen.headers['x-org-id']).toBeUndefined();
});
test('every API prefix is routed to its service path', async () => {
  const app = plain(); const auth = { Authorization: bearer({ sub: 'u1', orgId: 'o1', role: 'ADMIN', plan: 'FREE' }) };
  for (const [from, to] of [['/api/projects', '/projects'], ['/api/projects/abc?x=1', '/projects/abc?x=1'], ['/api/tasks/t1/status', '/tasks/t1/status'], ['/api/notifications/unread-count', '/notifications/unread-count'], ['/api/analytics/overview', '/analytics/overview']]) {
    await request(app).get(from).set(auth).expect(200);
    expect(seen.url).toBe(to);
  }
});
test('docs index lists services and proxies each Swagger UI', async () => {
  const app = plain();
  expect((await request(app).get('/docs').expect(200)).text).toContain('/docs/task/');
  await request(app).get('/docs/task/').expect(200);
  expect(seen.url).toBe('/docs/');
});
test('unknown routes 404', async () => { await request(plain()).get('/nope').expect(404); });

describe('rate limiting', () => {
  const limited = async (extra = {}) => { const redis = new RedisMock(); await redis.flushall(); return { redis, app: createApp({ jwtSecret: SECRET, services: services(), redis, ...extra }) }; };
  const hit = (app, claims) => request(app).get('/api/tasks').set('Authorization', bearer(claims));

  test('FREE: 100 requests pass, the 101st gets 429 with Retry-After and headers', async () => {
    const { app } = await limited(); const c = { sub: 'u1', orgId: 'o1', role: 'MEMBER', plan: 'FREE' };
    let last;
    for (let i = 0; i < 100; i++) last = await hit(app, c);
    expect(last.status).toBe(200);
    expect(last.headers['x-ratelimit-limit']).toBe('100'); expect(last.headers['x-ratelimit-remaining']).toBe('0');
    const denied = await hit(app, c);
    expect(denied.status).toBe(429);
    expect(Number(denied.headers['retry-after'])).toBeGreaterThan(0);
    expect(denied.body.error.code).toBe('RATE_LIMITED');
  });
  test('limits are per org+user and follow the plan stored in Redis (not the stale token)', async () => {
    const { app, redis } = await limited();
    await redis.set('org:plan:o2', 'PRO');
    const stale = { sub: 'u1', orgId: 'o2', role: 'MEMBER', plan: 'FREE' };
    expect((await hit(app, stale)).headers['x-ratelimit-limit']).toBe('500');
    await redis.set('org:plan:o3', 'ENTERPRISE'); await redis.set('org:limit:o3', '7');
    const ent = { sub: 'u1', orgId: 'o3', role: 'MEMBER', plan: 'ENTERPRISE' };
    expect((await hit(app, ent)).headers['x-ratelimit-limit']).toBe('7');
    expect((await hit(app, { ...ent, sub: 'other-user' })).headers['x-ratelimit-remaining']).toBe('6'); // separate bucket
  });
  test('public auth endpoints are limited per IP (brute-force guard)', async () => {
    const { app } = await limited(); let status;
    for (let i = 0; i < 31; i++) status = (await request(app).post('/api/auth/login').send({})).status;
    expect(status).toBe(429);
  });
  test('fails open when Redis is down', async () => {
    const redis = { mget: async () => { throw new Error('down'); }, eval: async () => { throw new Error('down'); } };
    const app = createApp({ jwtSecret: SECRET, services: services(), redis });
    await hit(app, { sub: 'u1', orgId: 'o1', role: 'MEMBER', plan: 'FREE' }).expect(200);
  });
});
