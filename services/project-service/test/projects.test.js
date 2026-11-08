const request = require('supertest');
const RedisMock = require('ioredis-mock');
const { createApp } = require('../src/app');
const { visibleFilter, canSee } = require('../src/access');

const ORG = 'org1';
function setup(rows = []) {
  const calls = []; const events = [];
  const scoped = (org) => ({
    find: async (f) => (calls.push(['find', org, f]), rows), count: async () => rows.length,
    create: async (d) => { const r = { _id: '507f1f77bcf86cd799439011', ...d }; rows.push(r); return r; },
    findById: async (id) => rows.find((r) => String(r._id) === id) || null,
    findOneAndUpdate: async (f) => rows.find((r) => String(r._id) === f._id) || null,
  });
  const redis = new RedisMock();
  const app = createApp({
    repo: { forOrg: scoped }, redis, internalToken: 'int',
    outbox: { enqueue: async (e) => events.push(e) }, tx: (fn) => fn(undefined),
    authClient: { get: async (p) => ({ isMember: !p.includes('stranger') }) },
  });
  return { app, calls, events, rows, redis };
}
const as = (role, user = 'u1') => ({ 'x-user-id': user, 'x-org-id': ORG, 'x-role': role });
const proj = (members) => ({ _id: '507f1f77bcf86cd799439011', organizationId: ORG, name: 'P', members, status: 'ACTIVE' });

test('visibility rules', () => {
  expect(visibleFilter({ id: 'u1', role: 'ADMIN' })).toEqual({});
  expect(visibleFilter({ id: 'u1', role: 'MEMBER' })).toEqual({ members: 'u1' });
  expect(canSee({ id: 'u2', role: 'MEMBER' }, { members: ['u1'] })).toBe(false);
  expect(canSee({ id: 'u2', role: 'OWNER' }, { members: ['u1'] })).toBe(true);
});
test('MEMBER and VIEWER cannot create projects', async () => {
  const { app } = setup();
  await request(app).post('/projects').set(as('MEMBER')).send({ name: 'X' }).expect(403);
  await request(app).post('/projects').set(as('VIEWER')).send({ name: 'X' }).expect(403);
});
test('ADMIN creates a project; creator is a member; events are enqueued in the same tx', async () => {
  const { app, events } = setup();
  const res = await request(app).post('/projects').set(as('ADMIN', 'admin1')).send({ name: 'Roadmap', members: ['u2'] }).expect(201);
  expect(res.body.project.members).toEqual(['admin1', 'u2']);
  expect(events.map((e) => e.eventType)).toEqual(['PROJECT_CREATED', 'PROJECT_MEMBER_ADDED']);
  expect(events[0].organizationId).toBe(ORG);
});
test('adding someone outside the org is rejected', async () => {
  const { app } = setup([proj(['u1'])]);
  await request(app).post('/projects/507f1f77bcf86cd799439011/members').set(as('ADMIN')).send({ userId: 'stranger' }).expect(400);
});
test('list scopes MEMBERs to their projects but not ADMINs', async () => {
  const { app, calls } = setup();
  await request(app).get('/projects').set(as('MEMBER', 'u9')).expect(200);
  await request(app).get('/projects').set(as('ADMIN')).expect(200);
  expect(calls[0][2]).toEqual({ members: 'u9' });
  expect(calls[1][2]).toEqual({});
});
test('non-members get 404 (not 403) on a project; members and admins get it, then it is cached', async () => {
  const { app, redis } = setup([proj(['u1'])]);
  const id = '507f1f77bcf86cd799439011';
  await request(app).get(`/projects/${id}`).set(as('MEMBER', 'outsider')).expect(404);
  await request(app).get(`/projects/${id}`).set(as('MEMBER', 'u1')).expect(200);
  await request(app).get(`/projects/${id}`).set(as('ADMIN', 'someone')).expect(200);
  expect(await redis.get(`project:${ORG}:${id}`)).not.toBeNull();
});
test('update invalidates the cache and emits PROJECT_UPDATED', async () => {
  const { app, redis, events } = setup([proj(['u1'])]);
  const id = '507f1f77bcf86cd799439011';
  await request(app).get(`/projects/${id}`).set(as('ADMIN')).expect(200);
  await request(app).patch(`/projects/${id}`).set(as('ADMIN')).send({ name: 'New' }).expect(200);
  expect(await redis.get(`project:${ORG}:${id}`)).toBeNull();
  expect(events.at(-1).eventType).toBe('PROJECT_UPDATED');
});
test('invalid ids are 400; internal endpoint demands the token', async () => {
  const { app } = setup([proj(['u1'])]);
  await request(app).get('/projects/not-an-id').set(as('ADMIN')).expect(400);
  await request(app).get('/internal/projects/507f1f77bcf86cd799439011/membership/u1').set('x-org-id', ORG).expect(403);
  const ok = await request(app).get('/internal/projects/507f1f77bcf86cd799439011/membership/u1').set({ 'x-org-id': ORG, 'x-internal-token': 'int' }).expect(200);
  expect(ok.body).toEqual({ exists: true, status: 'ACTIVE', isMember: true });
});
