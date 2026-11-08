const request = require('supertest');
const { createApp } = require('../src/app');

const PROJECTS = [
  { projectId: 'p1', name: 'Alpha', status: 'ACTIVE', members: ['m1'] },
  { projectId: 'p2', name: 'Beta', status: 'ACTIVE', members: ['someone'] },
];
function setup() {
  const seen = [];
  const projects = { forOrg: () => ({ find: async (f) => PROJECTS.filter((p) => !f.members || p.members.includes(f.members)) }) };
  const tasks = { forOrg: () => ({
    find: async (f) => { seen.push(f); return [{ lastEventAt: '2030-01-01T00:00:00.000Z' }]; },
    aggregate: async (pipe) => {
      const ids = pipe[0].$match.projectId.$in; seen.push(ids);
      if (pipe[1].$group._id.p) return [{ _id: { p: 'p1', s: 'DONE' }, n: 1 }, { _id: { p: 'p1', s: 'TODO' }, n: 3 }, { _id: { p: 'p2', s: 'TODO' }, n: 2 }].filter((x) => ids.includes(x._id.p));
      if (pipe[1].$group._id === '$projectId') return [{ _id: 'p1', n: 2 }].filter((x) => ids.includes(x._id));
      return [{ _id: 'u1', open: 3, inProgress: 1, overdue: 1 }];
    },
  }) };
  const activity = { forOrg: () => ({ find: async (f) => { seen.push(f); return [{ _id: 'a', summary: 's' }]; } }) };
  return { app: createApp({ repos: { tasks, projects, activity } }), seen };
}
const as = (role, user = 'u1') => ({ 'x-user-id': user, 'x-org-id': 'o1', 'x-role': role });

test('overview: admins see every project with computed stats and freshness', async () => {
  const { app } = setup();
  const r = await request(app).get('/analytics/overview').set(as('ADMIN')).expect(200);
  expect(r.body.projects).toHaveLength(2);
  expect(r.body.projects[0]).toMatchObject({ projectId: 'p1', total: 4, completed: 1, pending: 3, overdue: 2, completionPct: 25 });
  expect(r.body.lastUpdatedAt).toBe('2030-01-01T00:00:00.000Z');
});
test('members only see analytics for their own projects', async () => {
  const { app } = setup();
  const r = await request(app).get('/analytics/overview').set(as('MEMBER', 'm1')).expect(200);
  expect(r.body.projects.map((p) => p.projectId)).toEqual(['p1']);
  await request(app).get('/analytics/projects/p2').set(as('MEMBER', 'm1')).expect(404);
  await request(app).get('/analytics/projects/p1').set(as('MEMBER', 'm1')).expect(200);
  await request(app).get('/analytics/workload?projectId=p2').set(as('MEMBER', 'm1')).expect(404);
});
test('workload and overdue are scoped to visible projects; activity paginates', async () => {
  const { app, seen } = setup();
  const w = await request(app).get('/analytics/workload').set(as('MEMBER', 'm1')).expect(200);
  expect(w.body.workload[0]).toEqual({ userId: 'u1', open: 3, inProgress: 1, overdue: 1 });
  expect(seen).toContainEqual(['p1']);
  await request(app).get('/analytics/overdue').set(as('ADMIN')).expect(200);
  const a = await request(app).get('/analytics/activity?limit=5').set(as('ADMIN')).expect(200);
  expect(a.body.items).toHaveLength(1); expect(a.body.nextCursor).toBeNull();
});
test('requires identity', async () => {
  await request(setup().app).get('/analytics/overview').expect(403);
});
