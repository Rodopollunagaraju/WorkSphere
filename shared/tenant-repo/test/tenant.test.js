const { TenantRepository } = require('../src');

function fakeModel() {
  const calls = [];
  const chain = (result) => { const q = { result }; for (const m of ['sort', 'skip', 'limit', 'select', 'session']) q[m] = () => q; q.lean = () => Promise.resolve(result); q.then = (res, rej) => Promise.resolve(result).then(res, rej); return q; };
  return {
    calls,
    find: (f) => (calls.push(['find', f]), chain([])),
    findOne: (f) => (calls.push(['findOne', f]), chain(null)),
    countDocuments: (f) => (calls.push(['count', f]), chain(0)),
    create: async (docs) => (calls.push(['create', docs]), docs),
    updateOne: async (f, u) => calls.push(['updateOne', f, u]),
    updateMany: async (f, u) => calls.push(['updateMany', f, u]),
    findOneAndUpdate: (f, u) => (calls.push(['fou', f, u]), chain(null)),
    deleteOne: async (f) => calls.push(['deleteOne', f]),
    aggregate: (p) => (calls.push(['aggregate', p]), Promise.resolve([])),
  };
}

test('requires an organization context', () => {
  expect(() => new TenantRepository(fakeModel()).forOrg('')).toThrow();
  expect(() => new TenantRepository(fakeModel()).forOrg(undefined)).toThrow();
});
test('every read ANDs the tenant filter last; a spoofed organizationId cannot win', async () => {
  const m = fakeModel();
  const repo = new TenantRepository(m).forOrg('orgA');
  await repo.find({ organizationId: 'orgB', status: 'x' });
  await repo.findOne({ _id: '1' });
  await repo.count({});
  for (const [, f] of m.calls) expect(f.$and[f.$and.length - 1]).toEqual({ organizationId: 'orgA' });
  expect(m.calls[0][1].$and[0]).toEqual({ organizationId: 'orgB', status: 'x' }); // ANDed, so matches nothing
});
test('create forces the tenant, overriding a supplied organizationId', async () => {
  const m = fakeModel();
  const doc = await new TenantRepository(m).forOrg('orgA').create({ name: 'n', organizationId: 'orgB' });
  expect(doc.organizationId).toBe('orgA');
});
test('updates cannot move a document to another tenant', () => {
  const repo = new TenantRepository(fakeModel()).forOrg('orgA');
  expect(() => repo.updateOne({ _id: 1 }, { $set: { organizationId: 'orgB' } })).toThrow();
  expect(() => repo.findOneAndUpdate({ _id: 1 }, { organizationId: 'orgB' })).toThrow();
});
test('update and delete are tenant-scoped; dangerous operators rejected', async () => {
  const m = fakeModel();
  const repo = new TenantRepository(m).forOrg('orgA');
  await repo.updateOne({ _id: 1 }, { $set: { a: 1 } });
  await repo.deleteOne({ _id: 1 });
  expect(m.calls[0][1].$and[1]).toEqual({ organizationId: 'orgA' });
  expect(m.calls[1][1].$and[1]).toEqual({ organizationId: 'orgA' });
  expect(() => repo.find({ $where: 'sleep(1000)' })).toThrow();
  expect(() => repo.find({ a: { $or: [{ $function: {} }] } })).toThrow();
});
test('aggregate is prefixed with the tenant match', async () => {
  const m = fakeModel();
  await new TenantRepository(m).forOrg('orgA').aggregate([{ $group: { _id: '$status' } }]);
  expect(m.calls[0][1][0]).toEqual({ $match: { organizationId: 'orgA' } });
});

test('updateMany is tenant-scoped and cannot rewrite organizationId', async () => {
  const m = fakeModel(); const repo = new TenantRepository(m).forOrg('orgA');
  await repo.updateMany({ isRead: false }, { $set: { isRead: true } });
  expect(m.calls[0][1].$and[1]).toEqual({ organizationId: 'orgA' });
  expect(() => repo.updateMany({}, { $set: { organizationId: 'x' } })).toThrow();
});
