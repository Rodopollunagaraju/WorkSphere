// End-to-end tests against the RUNNING stack:   docker compose up --build -d  &&  npm run test:e2e
// They exercise the real gateway, services, Mongo, Redis and Kafka, so asynchronous effects use eventually().
const { call, eventually, newUser, newOrg, addMember, newProject } = require('../scripts/lib');

const run = process.env.E2E === '1' ? describe : describe.skip;
jest.setTimeout(90000);

run('WorkSphere end to end', () => {
  test('tenant isolation: org B can never see or enter org A', async () => {
    const a = await newOrg(await newUser('alice'), 'Org A');
    const b = await newOrg(await newUser('bob'), 'Org B');
    const project = await newProject(a);
    const task = (await call('POST', '/tasks', { token: a.token, body: { projectId: project._id, title: 'secret' } })).data.task;

    expect((await call('GET', `/projects/${project._id}`, { token: b.token })).status).toBe(404);
    expect((await call('GET', `/tasks?projectId=${project._id}`, { token: b.token })).status).toBe(404);
    expect((await call('GET', `/tasks/${task._id}`, { token: b.token })).status).toBe(404);
    expect((await call('GET', `/analytics/projects/${project._id}`, { token: b.token })).status).toBe(404);
    expect((await call('GET', '/projects', { token: b.token })).data.items).toHaveLength(0);
    // switching into someone else's org is refused by the Auth service
    expect((await call('POST', '/auth/switch-org', { token: b.owner.userToken, body: { orgId: a.orgId } })).status).toBe(403);
  });

  test('roles: VIEWER is read-only, MEMBER cannot manage projects, spoofed headers are ignored', async () => {
    const org = await newOrg(await newUser('owner'));
    const project = await newProject(org);
    const member = await addMember(org, 'MEMBER');
    const viewer = await addMember(org, 'VIEWER');
    expect((await call('POST', '/projects', { token: member.token, body: { name: 'nope' } })).status).toBe(403);
    expect((await call('POST', '/tasks', { token: viewer.token, body: { projectId: project._id, title: 'x' } })).status).toBe(403);
    const res = await fetch(`${require('../scripts/lib').BASE}/projects`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${member.token}`, 'x-role': 'OWNER', 'x-org-id': 'evil' }, body: JSON.stringify({ name: 'x' }) });
    expect(res.status).toBe(403); // the gateway discards client-supplied identity headers
  });

  test('assign a task: notification, analytics and activity react independently', async () => {
    const org = await newOrg(await newUser('owner'));
    const member = await addMember(org, 'MEMBER', 'dev');
    const project = await newProject(org, 'Launch', [member.userId]);
    const created = await call('POST', '/tasks', { token: org.token, body: { projectId: project._id, title: 'Ship it', assignedTo: member.userId, dueDate: new Date(Date.now() + 3600e3).toISOString() } });
    expect(created.status).toBe(201);
    const task = created.data.task;

    // 1. Notification service: assignee is notified, unread counter is in Redis
    const note = await eventually(async () => (await call('GET', '/notifications', { token: member.token })).data.items.find((n) => n.type === 'TASK_ASSIGNED'));
    expect(note.message).toContain('Ship it');
    expect((await call('GET', '/notifications/unread-count', { token: member.token })).data.count).toBeGreaterThanOrEqual(1);

    // 2. Analytics read model (eventually consistent)
    const stats = await eventually(async () => { const r = await call('GET', `/analytics/projects/${project._id}`, { token: org.token }); return r.status === 200 && r.data.total === 1 ? r.data : null; });
    expect(stats).toMatchObject({ total: 1, pending: 1, completed: 0 });
    expect(stats.lastUpdatedAt).toBeTruthy();

    // 3. Activity log
    const feed = await eventually(async () => { const r = await call('GET', '/analytics/activity', { token: org.token }); return r.data.items.some((i) => i.summary.includes('Ship it')) ? r.data.items : null; });
    expect(feed.length).toBeGreaterThan(0);

    // complete the task through the workflow; creator is notified, completion reaches 100%
    for (const status of ['IN_PROGRESS', 'IN_REVIEW', 'DONE']) expect((await call('POST', `/tasks/${task._id}/status`, { token: member.token, body: { status } })).status).toBe(200);
    expect((await call('POST', `/tasks/${task._id}/status`, { token: member.token, body: { status: 'TODO' } })).status).toBe(400); // DONE -> TODO not allowed
    await eventually(async () => (await call('GET', '/notifications', { token: org.token })).data.items.find((n) => n.type === 'TASK_COMPLETED'));
    await eventually(async () => (await call('GET', `/analytics/projects/${project._id}`, { token: org.token })).data.completionPct === 100);
  });

  test('optimistic concurrency: a stale version is rejected with 409 and the current task', async () => {
    const org = await newOrg(await newUser('owner'));
    const project = await newProject(org);
    const task = (await call('POST', '/tasks', { token: org.token, body: { projectId: project._id, title: 'v1' } })).data.task;
    expect((await call('PATCH', `/tasks/${task._id}`, { token: org.token, body: { version: 1, title: 'first' } })).status).toBe(200);
    const stale = await call('PATCH', `/tasks/${task._id}`, { token: org.token, body: { version: 1, title: 'second' } });
    expect(stale.status).toBe(409);
    expect(stale.data.error.details.current.title).toBe('first');
  });

  test('refresh tokens rotate and a replayed token revokes the session', async () => {
    const u = await newUser('rot');
    const r1 = await call('POST', '/auth/refresh', { body: { refreshToken: u.refreshToken } });
    expect(r1.status).toBe(200);
    expect((await call('POST', '/auth/refresh', { body: { refreshToken: u.refreshToken } })).status).toBe(401); // reuse detected
    expect((await call('POST', '/auth/refresh', { body: { refreshToken: r1.data.refreshToken } })).status).toBe(401); // whole family revoked
  });

  test('rate limiting: a FREE org is throttled at 100/min; a plan upgrade lifts it immediately', async () => {
    const owner = await newUser('limited');
    const org = await newOrg(owner);
    // a co-owner has their own rate-limit bucket, so they can still upgrade the plan while the first owner is throttled
    const co = await addMember(org, 'ADMIN', 'co-owner');
    expect((await call('PATCH', `/auth/members/${co.userId}/role`, { token: org.token, body: { role: 'OWNER' } })).status).toBe(200);
    const coToken = (await call('POST', '/auth/switch-org', { token: co.userToken, body: { orgId: org.orgId } })).data.accessToken;

    let denied;
    for (let i = 0; i < 140 && !denied; i++) { const r = await call('GET', '/projects', { token: org.token }); if (r.status === 429) denied = r; }
    expect(denied).toBeDefined();
    expect(Number(denied.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(denied.data.error.code).toBe('RATE_LIMITED');

    // upgrade: the plan is read from Redis, so the (stale FREE) token of the throttled owner is allowed again at once
    expect((await call('PATCH', '/auth/organizations/plan', { token: coToken, body: { plan: 'ENTERPRISE', rateLimit: 100000 } })).status).toBe(200);
    const after = await call('GET', '/projects', { token: org.token });
    expect(after.status).toBe(200);
    expect(after.headers.get('x-ratelimit-limit')).toBe('100000');
  });
});
