const { buildStats, describe } = require('../src/stats');
const { createAnalyticsHandlers, createActivityHandlers } = require('../src/handlers');

test('buildStats computes totals, pending and completion percentage', () => {
  expect(buildStats({ TODO: 2, IN_PROGRESS: 1, DONE: 1 }, 1)).toEqual({ total: 4, completed: 1, pending: 3, overdue: 1, byStatus: { TODO: 2, IN_PROGRESS: 1, IN_REVIEW: 0, DONE: 1 }, completionPct: 25 });
  expect(buildStats()).toMatchObject({ total: 0, completionPct: 0 });
});
test('describe renders readable activity lines', () => {
  expect(describe({ eventType: 'TASK_STATUS_CHANGED', payload: { snapshot: { title: 'T' }, from: 'TODO', to: 'DONE' } })).toBe('moved "T" from TODO to DONE');
});

function fakeModels() {
  const tasks = new Map(); const projects = new Map(); const logs = [];
  return {
    tasks, projects, logs,
    models: {
      TaskSnapshot: { findOne: ({ taskId }) => ({ session: () => ({ lean: async () => tasks.get(taskId) || null }) }), updateOne: async ({ taskId }, u) => tasks.set(taskId, { ...(tasks.get(taskId) || {}), ...u.$set }) },
      ProjectSnapshot: { updateOne: async ({ projectId }, u) => { const cur = projects.get(projectId) || { members: [] }; const next = { ...cur, ...(u.$set || {}) }; if (u.$addToSet) next.members = [...new Set([...cur.members, u.$addToSet.members])]; if (u.$pull) next.members = cur.members.filter((m) => m !== u.$pull.members); projects.set(projectId, next); } },
      ActivityLog: { create: async (docs) => { logs.push(...docs); } },
    },
  };
}
const ev = (eventType, payload, actorId = 'a1') => ({ eventId: `e-${Math.random()}`, eventType, organizationId: 'o1', actorId, occurredAt: new Date().toISOString(), payload });
const s = (o = {}) => ({ title: 'T', status: 'TODO', assignedTo: 'u1', version: 1, ...o });

test('read model follows the latest task version and survives replays / reordering', async () => {
  const { models, tasks } = fakeModels(); const h = createAnalyticsHandlers({ models });
  await h.TASK_CREATED(ev('TASK_CREATED', { taskId: 't', projectId: 'p', snapshot: s() }), { session: null });
  await h.TASK_STATUS_CHANGED(ev('TASK_STATUS_CHANGED', { taskId: 't', projectId: 'p', from: 'TODO', to: 'DONE', snapshot: s({ status: 'DONE', version: 3 }) }), { session: null });
  await h.TASK_STATUS_CHANGED(ev('TASK_STATUS_CHANGED', { taskId: 't', projectId: 'p', from: 'TODO', to: 'IN_PROGRESS', snapshot: s({ status: 'IN_PROGRESS', version: 2 }) }), { session: null });
  expect(tasks.get('t')).toMatchObject({ status: 'DONE', version: 3 });
  await h.TASK_DELETED(ev('TASK_DELETED', { taskId: 't', projectId: 'p', snapshot: s({ version: 4 }) }), { session: null });
  expect(tasks.get('t').deleted).toBe(true);
});
test('project read model tracks name, status and members (creator included)', async () => {
  const { models, projects } = fakeModels(); const h = createAnalyticsHandlers({ models });
  await h.PROJECT_CREATED(ev('PROJECT_CREATED', { projectId: 'p', name: 'Roadmap' }, 'admin'), { session: null });
  await h.PROJECT_MEMBER_ADDED(ev('PROJECT_MEMBER_ADDED', { projectId: 'p', userId: 'u2' }), { session: null });
  await h.PROJECT_MEMBER_REMOVED(ev('PROJECT_MEMBER_REMOVED', { projectId: 'p', userId: 'admin' }), { session: null });
  await h.PROJECT_ARCHIVED(ev('PROJECT_ARCHIVED', { projectId: 'p' }), { session: null });
  expect(projects.get('p')).toEqual({ name: 'Roadmap', status: 'ARCHIVED', members: ['u2'] });
});
test('activity handler records every event type with a readable summary', async () => {
  const { models, logs } = fakeModels();
  const h = createActivityHandlers({ models, eventTypes: ['TASK_COMPLETED', 'MEMBER_JOINED'] });
  await h.TASK_COMPLETED(ev('TASK_COMPLETED', { taskId: 't', projectId: 'p', snapshot: s() }), { session: null });
  await h.MEMBER_JOINED(ev('MEMBER_JOINED', { userId: 'u1', role: 'MEMBER', name: 'Ada' }), { session: null });
  expect(logs.map((l) => l.summary)).toEqual(['completed "T"', 'Ada joined as MEMBER']);
  expect(logs[0]).toMatchObject({ entityType: 'task', entityId: 't', projectId: 'p', organizationId: 'o1' });
});
