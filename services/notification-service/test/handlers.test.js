const { createHandlers, resetReminders } = require('../src/handlers');

function setup() {
  const delivered = []; const invites = []; const created = []; const dir = []; const deadlines = new Map();
  const models = {
    Notification: { create: async (items) => items.map((i, n) => { const d = { ...i, _id: `n${created.length + n}` }; created.push(d); return { ...d, toObject: () => d }; }) },
    UserDirectory: { updateOne: async (f, u) => dir.push({ f, u }) },
    TaskDeadline: {
      findOne: ({ taskId }) => ({ session: () => ({ lean: async () => deadlines.get(taskId) || null }) }),
      updateOne: async ({ taskId }, u) => deadlines.set(taskId, { ...(deadlines.get(taskId) || {}), ...u.$set }),
    },
  };
  const handlers = createHandlers({ models, deliver: async (n) => delivered.push(...n), sendInviteEmail: async (e) => invites.push(e.payload.email) });
  return { handlers, delivered, invites, created, dir, deadlines };
}
const snap = (o = {}) => ({ title: 'Ship it', status: 'TODO', assignedTo: 'u2', createdBy: 'creator', version: 1, ...o });
const ev = (eventType, payload, actorId = 'actor') => ({ eventType, organizationId: 'o1', actorId, occurredAt: new Date().toISOString(), payload });
const run = async (fn, e) => { const after = await fn(e, { session: {} }); if (after) await after(); };

test('TASK_ASSIGNED notifies the assignee after commit, never the actor themself', async () => {
  const { handlers, delivered } = setup();
  const e = ev('TASK_ASSIGNED', { taskId: 't1', projectId: 'p1', assignedTo: 'u2', snapshot: snap() });
  await run(handlers.TASK_ASSIGNED, e);
  expect(delivered).toHaveLength(1);
  expect(delivered[0]).toMatchObject({ userId: 'u2', type: 'TASK_ASSIGNED', organizationId: 'o1' });
  await run(handlers.TASK_ASSIGNED, ev('TASK_ASSIGNED', e.payload, 'u2')); // self-assign
  expect(delivered).toHaveLength(1);
});
test('side effects are deferred: nothing is delivered until the returned post-commit function runs', async () => {
  const { handlers, delivered } = setup();
  const after = await handlers.TASK_ASSIGNED(ev('TASK_ASSIGNED', { taskId: 't1', projectId: 'p1', assignedTo: 'u2', snapshot: snap() }), { session: {} });
  expect(delivered).toHaveLength(0);
  await after();
  expect(delivered).toHaveLength(1);
});
test('TASK_COMPLETED notifies the creator (not the actor)', async () => {
  const { handlers, delivered } = setup();
  await run(handlers.TASK_COMPLETED, ev('TASK_COMPLETED', { taskId: 't1', projectId: 'p1', snapshot: snap({ status: 'DONE', version: 4 }) }));
  expect(delivered[0]).toMatchObject({ userId: 'creator', type: 'TASK_COMPLETED' });
  await run(handlers.TASK_COMPLETED, ev('TASK_COMPLETED', { taskId: 't1', projectId: 'p1', snapshot: snap({ version: 5 }) }, 'creator'));
  expect(delivered).toHaveLength(1);
});
test('comment mentions notify each mentioned user except the author', async () => {
  const { handlers, delivered } = setup();
  await run(handlers.COMMENT_ADDED, ev('COMMENT_ADDED', { taskId: 't', projectId: 'p', commentId: 'c', mentions: ['a', 'b', 'actor'], taskTitle: 'X' }));
  expect(delivered.map((d) => d.userId)).toEqual(['a', 'b']);
  expect(delivered[0].type).toBe('MENTION');
});
test('project invitation, invite email, and directory upsert', async () => {
  const { handlers, delivered, invites, dir } = setup();
  await run(handlers.PROJECT_MEMBER_ADDED, ev('PROJECT_MEMBER_ADDED', { projectId: 'p', userId: 'u9', projectName: 'Roadmap' }));
  expect(delivered[0]).toMatchObject({ userId: 'u9', type: 'PROJECT_INVITATION' });
  await run(handlers.MEMBER_INVITED, ev('MEMBER_INVITED', { email: 'new@x.com', role: 'MEMBER', inviteToken: 'tok' }));
  expect(invites).toEqual(['new@x.com']);
  await run(handlers.MEMBER_JOINED, ev('MEMBER_JOINED', { userId: 'u1', role: 'OWNER', email: 'a@x.com', name: 'Ada' }));
  expect(dir[0].u.$set).toEqual({ email: 'a@x.com', name: 'Ada' });
});
test('task events feed the local deadline read model; stale versions ignored; due-date change resets reminders', async () => {
  const { handlers, deadlines } = setup();
  await run(handlers.TASK_CREATED, ev('TASK_CREATED', { taskId: 't1', projectId: 'p', snapshot: snap({ dueDate: '2030-01-01T00:00:00.000Z' }) }));
  expect(deadlines.get('t1')).toMatchObject({ reminded24h: false, remindedOverdue: false });
  await run(handlers.TASK_UPDATED, ev('TASK_UPDATED', { taskId: 't1', projectId: 'p', changes: {}, snapshot: snap({ version: 3, dueDate: '2030-02-01T00:00:00.000Z' }) }));
  await run(handlers.TASK_UPDATED, ev('TASK_UPDATED', { taskId: 't1', projectId: 'p', changes: {}, snapshot: snap({ version: 2, title: 'stale' }) }));
  expect(deadlines.get('t1').title).toBe('Ship it');
  expect(deadlines.get('t1').version).toBe(3);
});
test('resetReminders only fires on new tasks or a changed due date', () => {
  const d = new Date('2030-01-01');
  expect(resetReminders(null, { dueDate: d })).toEqual({ reminded24h: false, remindedOverdue: false });
  expect(resetReminders({ dueDate: d }, { dueDate: new Date('2030-01-01') })).toEqual({});
  expect(resetReminders({ dueDate: d }, { dueDate: new Date('2031-01-01') })).toEqual({ reminded24h: false, remindedOverdue: false });
});
