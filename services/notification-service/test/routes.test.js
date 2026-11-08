const request = require('supertest');
const RedisMock = require('ioredis-mock');
const { createApp } = require('../src/app');

const pad = (n) => String(n).padStart(24, '0');
function setup(seed = []) {
  const rows = seed.map((r, i) => ({ _id: pad(i + 1), organizationId: 'o1', isRead: false, ...r }));
  const prefs = [];
  const match = (r, f) => Object.entries(f).every(([k, v]) => (v && typeof v === 'object' && '$lt' in v ? r[k] < v.$lt : r[k] === v));
  const notifications = { forOrg: (org) => ({
    find: async (f, o = {}) => { let out = rows.filter((r) => r.organizationId === org && match(r, f)).sort((a, b) => (a._id < b._id ? 1 : -1)); return o.limit ? out.slice(0, o.limit) : out; },
    count: async (f) => rows.filter((r) => r.organizationId === org && match(r, f)).length,
    findOne: async (f) => rows.find((r) => r.organizationId === org && match(r, f)) || null,
    findOneAndUpdate: async (f, u) => { const r = rows.find((x) => x.organizationId === org && match(x, f)); if (r) Object.assign(r, u.$set); return r || null; },
    updateMany: async (f, u) => rows.filter((r) => r.organizationId === org && match(r, f)).forEach((r) => Object.assign(r, u.$set)),
  }) };
  const preferences = { forOrg: () => ({ findOne: async () => prefs[0] || null, findOneAndUpdate: async (f, u) => { prefs[0] = { email: u.$set.email }; return prefs[0]; } }) };
  const redis = new RedisMock();
  return { app: createApp({ repos: { notifications, preferences }, redis }), redis, rows };
}
const as = (user = 'u1', org = 'o1') => ({ 'x-user-id': user, 'x-org-id': org, 'x-role': 'MEMBER' });

test('lists only my notifications within my org, newest first, with a reconciled unread count', async () => {
  const { app, redis } = setup([{ userId: 'u1', message: 'a' }, { userId: 'u2', message: 'other user' }, { userId: 'u1', message: 'b', organizationId: 'o2' }, { userId: 'u1', message: 'c' }]);
  await redis.flushall();
  const r = await request(app).get('/notifications').set(as()).expect(200);
  expect(r.body.items.map((i) => i.message)).toEqual(['c', 'a']);
  expect(r.body.unreadCount).toBe(2);
  expect(await redis.get('unread:o1:u1')).toBe('2'); // counter rebuilt from DB
});
test('marking read decrements the Redis counter exactly once and never below zero', async () => {
  const { app, redis } = setup([{ userId: 'u1', message: 'a' }, { userId: 'u1', message: 'b' }]);
  await redis.flushall(); await redis.set('unread:o1:u1', 2);
  const id = pad(1);
  expect((await request(app).post(`/notifications/${id}/read`).set(as()).expect(200)).body.count).toBe(1);
  expect((await request(app).post(`/notifications/${id}/read`).set(as()).expect(200)).body.count).toBe(1); // idempotent
  await request(app).post(`/notifications/${pad(99)}/read`).set(as()).expect(404);
  await request(app).post(`/notifications/${pad(2)}/read`).set(as('u2')).expect(404); // not mine
});
test('read-all zeroes the counter; preferences round-trip; presence lists online users', async () => {
  const { app, redis } = setup([{ userId: 'u1', message: 'a' }]);
  await redis.flushall(); await redis.set('unread:o1:u1', 1);
  await request(app).post('/notifications/read-all').set(as()).expect(200);
  expect((await request(app).get('/notifications/unread-count').set(as())).body.count).toBe(0);
  expect((await request(app).get('/notifications/preferences').set(as())).body.email).toBe(true);
  await request(app).put('/notifications/preferences').set(as()).send({ email: false }).expect(200);
  expect((await request(app).get('/notifications/preferences').set(as())).body.email).toBe(false);
  await redis.zadd('presence:o1', Date.now(), 'u7');
  expect((await request(app).get('/notifications/presence').set(as())).body.online).toEqual(['u7']);
});
test('requires identity', async () => {
  await request(setup().app).get('/notifications').expect(403);
});
