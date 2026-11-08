const request = require('supertest');
const RedisMock = require('ioredis-mock');
const { createApp } = require('../src/app');
const createHandlers = require('../src/handlers');

const ORG = 'org1';
const pad = (n) => String(n).padStart(24, '0');

// ---- in-memory stand-ins (same surface as the tenant-scoped repository) ----
function fakeRepo() {
  const rows = []; let n = 0;
  const match = (r, f) => Object.entries(f).every(([k, v]) => (v && typeof v === 'object' && '$lt' in v ? String(r[k]) < String(v.$lt) : r[k] === v));
  const cp = (r) => (r ? { ...r } : null);
  const apply = (r, u) => { Object.assign(r, u.$set || {}); for (const [k, v] of Object.entries(u.$inc || {})) r[k] = (r[k] || 0) + v; };
  const scoped = (org) => ({
    rows,
    find: async (f = {}, o = {}) => { let out = rows.filter((r) => r.organizationId === org && match(r, f)); if (o.sort && o.sort._id === -1) out = out.sort((a, b) => (a._id < b._id ? 1 : -1)); out = out.map(cp); return o.limit ? out.slice(0, o.limit) : out; },
    findById: async (id) => cp(rows.find((r) => r.organizationId === org && r._id === id)),
    findOne: async (f) => cp(rows.find((r) => r.organizationId === org && match(r, f))),
    create: async (d) => { const many = Array.isArray(d); const made = (many ? d : [d]).map((x) => { const row = { _id: pad(++n), organizationId: org, createdAt: new Date(), ...x }; rows.push(row); return row; }); return many ? made : made[0]; },
    findOneAndUpdate: async (f, u) => { const r = rows.find((x) => x.organizationId === org && match(x, f)); if (r) apply(r, u); return cp(r); },
    deleteOne: async (f) => { const i = rows.findIndex((x) => x.organizationId === org && match(x, f)); if (i >= 0) rows.splice(i, 1); },
    deleteMany: async (f) => { for (let i = rows.length - 1; i >= 0; i--) if (rows[i].organizationId === org && match(rows[i], f)) rows.splice(i, 1); },
  });
  return { forOrg: scoped, rows };
}
const PROJECTS = { p1: { exists: true, status: 'ACTIVE', members: ['u1', 'u2', 'admin'] }, parch: { exists: true, status: 'ARCHIVED', members: ['u1'] } };
const projectClient = { get: async (path) => { const [, , pid, , uid] = path.split('/').slice(1); const p = PROJECTS[pid]; return p ? { exists: true, status: p.status, isMember: p.members.includes(uid) } : { exists: false, isMember: false, status: null }; } };

function setup() {
  const events = []; const repos = { tasks: fakeRepo(), comments: fakeRepo(), history: fakeRepo(), attachments: fakeRepo() };
  const redis = new RedisMock();
  const storage = { presignPut: async (k) => `http://minio/${k}?sig`, presignGet: async (k) => `http://minio/${k}?get`, head: async () => ({ size: 100 }) };
  const app = createApp({ repos, redis, projectClient, storage, tx: (fn) => fn(undefined), outbox: { enqueue: async (e) => events.push(e) } });
  return { app, events, repos, redis };
}
const as = (role, user = 'u1') => ({ 'x-user-id': user, 'x-org-id': ORG, 'x-role': role });
const mk = (app, body = {}, who = as('MEMBER')) => request(app).post('/tasks').set(who).send({ projectId: 'p1', title: 'Write docs', ...body });

test('VIEWER cannot create; non-members of the project get 404', async () => {
  const { app } = setup();
  await mk(app, {}, as('VIEWER')).expect(403);
  await mk(app, {}, as('MEMBER', 'outsider')).expect(404);
  await mk(app, { projectId: 'nope' }).expect(404);
});
test('create emits TASK_CREATED and writes history in the same unit of work', async () => {
  const { app, events, repos } = setup();
  const res = await mk(app).expect(201);
  expect(res.body.task).toMatchObject({ status: 'TODO', version: 1, organizationId: ORG });
  expect(events.map((e) => e.eventType)).toEqual(['TASK_CREATED']);
  expect(events[0].payload.snapshot.version).toBe(1);
  expect(repos.history.rows).toHaveLength(1);
});
test('create with assignee also emits TASK_ASSIGNED; non-member assignee is rejected', async () => {
  const { app, events } = setup();
  await mk(app, { assignedTo: 'u2' }).expect(201);
  expect(events.map((e) => e.eventType)).toEqual(['TASK_CREATED', 'TASK_ASSIGNED']);
  await mk(app, { assignedTo: 'stranger' }).expect(400);
});
test('archived projects reject new tasks', async () => {
  await mk(setup().app, { projectId: 'parch' }).expect(400);
});
test('optimistic concurrency: the second writer with a stale version gets 409 and the current state', async () => {
  const { app } = setup();
  const { body } = await mk(app).expect(201);
  const id = body.task._id;
  await request(app).patch(`/tasks/${id}`).set(as('MEMBER')).send({ version: 1, title: 'A' }).expect(200);
  const stale = await request(app).patch(`/tasks/${id}`).set(as('MEMBER', 'u2')).send({ version: 1, title: 'B' }).expect(409);
  expect(stale.body.error.details.current).toMatchObject({ title: 'A', version: 2 });
});
test('no-op update does not bump version or emit', async () => {
  const { app, events } = setup();
  const id = (await mk(app)).body.task._id; events.length = 0;
  const r = await request(app).patch(`/tasks/${id}`).set(as('MEMBER')).send({ version: 1, title: 'Write docs' }).expect(200);
  expect(r.body.unchanged).toBe(true); expect(events).toHaveLength(0);
});
test('status workflow is enforced; DONE also emits TASK_COMPLETED', async () => {
  const { app, events } = setup();
  const id = (await mk(app)).body.task._id; events.length = 0;
  const bad = await request(app).post(`/tasks/${id}/status`).set(as('MEMBER')).send({ status: 'DONE' }).expect(400);
  expect(bad.body.error.details.allowed).toEqual(['IN_PROGRESS']);
  for (const s of ['IN_PROGRESS', 'IN_REVIEW', 'DONE']) await request(app).post(`/tasks/${id}/status`).set(as('MEMBER')).send({ status: s }).expect(200);
  expect(events.map((e) => e.eventType)).toEqual(['TASK_STATUS_CHANGED', 'TASK_STATUS_CHANGED', 'TASK_STATUS_CHANGED', 'TASK_COMPLETED']);
  expect(events.at(-1).payload.snapshot.version).toBe(4);
});
test('assign emits TASK_ASSIGNED with the previous assignee; unassign emits TASK_UPDATED', async () => {
  const { app, events } = setup();
  const id = (await mk(app, { assignedTo: 'u1' })).body.task._id; events.length = 0;
  await request(app).post(`/tasks/${id}/assign`).set(as('MEMBER')).send({ assignedTo: 'u2' }).expect(200);
  expect(events[0]).toMatchObject({ eventType: 'TASK_ASSIGNED', payload: { assignedTo: 'u2', previousAssignee: 'u1' } });
  await request(app).post(`/tasks/${id}/assign`).set(as('MEMBER')).send({ assignedTo: null }).expect(200);
  expect(events[1].eventType).toBe('TASK_UPDATED');
});
test('comments extract @mentions into the COMMENT_ADDED event', async () => {
  const { app, events } = setup();
  const id = (await mk(app)).body.task._id; events.length = 0;
  const mention = 'a'.repeat(24);
  const r = await request(app).post(`/tasks/${id}/comments`).set(as('MEMBER')).send({ body: `hi @${mention} and @${mention}` }).expect(201);
  expect(r.body.comment.mentions).toEqual([mention]);
  expect(events[0]).toMatchObject({ eventType: 'COMMENT_ADDED', payload: { mentions: [mention], taskTitle: 'Write docs' } });
});
test('only the creator or an admin can delete; delete emits TASK_DELETED with a higher version', async () => {
  const { app, events } = setup();
  const id = (await mk(app)).body.task._id; events.length = 0;
  await request(app).delete(`/tasks/${id}`).set(as('MEMBER', 'u2')).expect(403);
  await request(app).delete(`/tasks/${id}`).set(as('ADMIN', 'admin')).expect(204);
  expect(events[0].payload.snapshot.version).toBe(2);
  await request(app).get(`/tasks/${id}`).set(as('ADMIN', 'admin')).expect(404);
});
test('list is cached and a write invalidates it via the version token', async () => {
  const { app, redis } = setup();
  await mk(app, { title: 'one' });
  const a = await request(app).get('/tasks?projectId=p1').set(as('MEMBER')).expect(200);
  expect(a.body.items).toHaveLength(1);
  expect((await redis.keys('tasklist:*')).length).toBeGreaterThan(1);
  await mk(app, { title: 'two' });
  const b = await request(app).get('/tasks?projectId=p1').set(as('MEMBER')).expect(200);
  expect(b.body.items).toHaveLength(2);
});
test('list paginates with a cursor', async () => {
  const { app } = setup();
  for (let i = 0; i < 3; i++) await mk(app, { title: `t${i}` });
  const p1 = await request(app).get('/tasks?projectId=p1&limit=2').set(as('MEMBER')).expect(200);
  expect(p1.body.items).toHaveLength(2); expect(p1.body.nextCursor).toBeTruthy();
  const p2 = await request(app).get(`/tasks?projectId=p1&limit=2&cursor=${p1.body.nextCursor}`).set(as('MEMBER')).expect(200);
  expect(p2.body.items).toHaveLength(1); expect(p2.body.nextCursor).toBeNull();
});
test('attachments: type and size are validated; keys are tenant/task scoped; confirm then download', async () => {
  const { app } = setup();
  const id = (await mk(app)).body.task._id;
  const pre = (b) => request(app).post(`/tasks/${id}/attachments/presign`).set(as('MEMBER')).send(b);
  await pre({ fileName: 'x.exe', contentType: 'application/x-msdownload', size: 10 }).expect(400);
  await pre({ fileName: 'big.pdf', contentType: 'application/pdf', size: 11 * 1024 * 1024 }).expect(400);
  const ok = await pre({ fileName: 'my file.pdf', contentType: 'application/pdf', size: 100 }).expect(201);
  expect(ok.body.uploadUrl).toContain(`org/${ORG}/task/${id}/`);
  expect(ok.body.uploadUrl).toContain('my_file.pdf');
  await request(app).get(`/tasks/${id}/attachments/${ok.body.attachmentId}/download`).set(as('MEMBER')).expect(404); // not confirmed yet
  await request(app).post(`/tasks/${id}/attachments/${ok.body.attachmentId}/confirm`).set(as('MEMBER')).expect(200);
  const dl = await request(app).get(`/tasks/${id}/attachments/${ok.body.attachmentId}/download`).set(as('VIEWER', 'u1')).expect(200);
  expect(dl.body.downloadUrl).toContain('?get');
});
test('project events invalidate cached membership lookups after commit', async () => {
  const redis = new RedisMock();
  await redis.set(`pm:${ORG}:p1:u1`, '{}'); await redis.set(`pm:${ORG}:p2:u1`, '{}');
  const after = await createHandlers({ redis }).PROJECT_MEMBER_REMOVED({ organizationId: ORG, payload: { projectId: 'p1' } });
  await after();
  expect(await redis.get(`pm:${ORG}:p1:u1`)).toBeNull();
  expect(await redis.get(`pm:${ORG}:p2:u1`)).toBe('{}');
});
