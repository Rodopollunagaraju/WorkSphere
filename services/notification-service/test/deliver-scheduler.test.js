const RedisMock = require('ioredis-mock');
const { createDeliver } = require('../src/deliver');
const { runReminders, reminderQuery } = require('../src/scheduler');

test('deliver bumps the Redis unread counter, pushes over the socket, and emails per preference', async () => {
  const redis = new RedisMock(); await redis.flushall();
  const pushed = []; const mails = [];
  const models = {
    Preference: { findOne: ({ userId }) => ({ lean: async () => (userId === 'quiet' ? { email: false } : null) }) },
    UserDirectory: { findOne: ({ userId }) => ({ lean: async () => ({ email: `${userId}@x.com` }) }) },
  };
  const deliver = createDeliver({ redis, models, mailer: { send: async (m) => mails.push(m.to) }, emitToUser: (o, u, ev, p) => pushed.push([u, ev, p]) });
  await deliver([{ _id: 1, organizationId: 'o', userId: 'u1', type: 'TASK_ASSIGNED', message: 'm' }, { _id: 2, organizationId: 'o', userId: 'u1', type: 'MENTION', message: 'm' }, { _id: 3, organizationId: 'o', userId: 'quiet', type: 'TASK_ASSIGNED', message: 'm' }]);
  expect(await redis.get('unread:o:u1')).toBe('2');
  expect(pushed.filter((p) => p[1] === 'notification')).toHaveLength(3);
  expect(mails).toEqual(['u1@x.com']); // MENTION is not emailed, 'quiet' opted out
});

function fakeModels(rows) {
  const notes = [];
  const TaskDeadline = {
    find: (q) => { const now = Date.now(); const out = rows.filter((r) => +r.dueDate <= +q.dueDate.$lte && !r.deleted && r.status !== 'DONE' && r.assignedTo && ((!r.reminded24h && +r.dueDate > now) || (!r.remindedOverdue && +r.dueDate <= now))); return { limit: () => ({ lean: async () => out.map((r) => ({ ...r })) }) }; },
    updateOne: async ({ _id, ...flag }, u) => { const r = rows.find((x) => x._id === _id); const [[k, v]] = Object.entries(flag); if (r && r[k] === v) { Object.assign(r, u.$set); return { modifiedCount: 1 }; } return { modifiedCount: 0 }; },
  };
  const Notification = { create: async (items) => items.map((i) => { notes.push(i); return { ...i, toObject: () => i }; }) };
  return { models: { TaskDeadline, Notification }, notes };
}
const soon = (h) => new Date(Date.now() + h * 3600 * 1000);
const row = (id, o) => ({ _id: id, organizationId: 'o', taskId: id, title: id, status: 'TODO', assignedTo: 'u1', deleted: false, reminded24h: false, remindedOverdue: false, ...o });

test('reminders: due-soon and overdue each fire once; done/unassigned/far-future are skipped', async () => {
  const rows = [row('soon', { dueDate: soon(5) }), row('late', { dueDate: soon(-5) }), row('far', { dueDate: soon(72) }), row('done', { dueDate: soon(5), status: 'DONE' }), row('nobody', { dueDate: soon(5), assignedTo: null })];
  const { models, notes } = fakeModels(rows); const delivered = [];
  const deliver = async (n) => delivered.push(...n);
  expect(await runReminders({ models, deliver })).toBe(2);
  expect(notes.map((n) => n.message).sort()).toEqual(['Due within 24h: soon', 'Overdue: late']);
  expect(await runReminders({ models, deliver })).toBe(0); // flags set: no repeats
  expect(delivered).toHaveLength(2);
});
test('two instances racing: the atomic flag flip means only one reminder is created', async () => {
  const rows = [row('t', { dueDate: soon(2) })];
  const { models, notes } = fakeModels(rows);
  const [a, b] = await Promise.all([runReminders({ models, deliver: async () => {} }), runReminders({ models, deliver: async () => {} })]);
  expect(a + b).toBe(1); expect(notes).toHaveLength(1);
});
test('reminderQuery targets open assigned tasks with a due date', () => {
  const q = reminderQuery(Date.now());
  expect(q.status).toEqual({ $ne: 'DONE' }); expect(q.deleted).toBe(false); expect(q.$or).toHaveLength(2);
});
