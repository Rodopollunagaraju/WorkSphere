const { applyTaskSnapshot } = require('../src');

function fakeModel() {
  const store = new Map();
  return {
    store,
    findOne: ({ taskId }) => ({ session: () => ({ lean: async () => store.get(taskId) || null }) }),
    updateOne: async ({ taskId }, u) => { store.set(taskId, { ...(store.get(taskId) || {}), ...u.$setOnInsert, ...u.$set }); },
  };
}
const ev = (type, version, status = 'TODO', extra = {}) => ({ eventType: type, organizationId: 'o', occurredAt: new Date().toISOString(), payload: { taskId: 't1', projectId: 'p1', snapshot: { title: 'x', status, version, ...extra } } });

test('newer versions apply; replays and stale events are ignored', async () => {
  const M = fakeModel();
  expect(await applyTaskSnapshot(M, ev('TASK_CREATED', 1))).toBe(true);
  expect(await applyTaskSnapshot(M, ev('TASK_STATUS_CHANGED', 3, 'DONE'))).toBe(true);
  expect(await applyTaskSnapshot(M, ev('TASK_STATUS_CHANGED', 2, 'IN_PROGRESS'))).toBe(false); // out of order
  expect(await applyTaskSnapshot(M, ev('TASK_STATUS_CHANGED', 3, 'DONE'))).toBe(false);        // replay
  expect(M.store.get('t1').status).toBe('DONE');
});
test('delete marks deleted; onChange can add fields', async () => {
  const M = fakeModel();
  await applyTaskSnapshot(M, ev('TASK_CREATED', 1, 'TODO', { dueDate: '2030-01-01T00:00:00.000Z' }), { onChange: () => ({ reminded24h: false }) });
  expect(M.store.get('t1').reminded24h).toBe(false);
  await applyTaskSnapshot(M, ev('TASK_DELETED', 2));
  expect(M.store.get('t1').deleted).toBe(true);
});
