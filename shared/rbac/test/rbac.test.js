const { atLeast, requireOrgRole, requireInternal } = require('../src');
test('role hierarchy', () => {
  expect(atLeast('OWNER', 'ADMIN')).toBe(true);
  expect(atLeast('MEMBER', 'ADMIN')).toBe(false);
  expect(atLeast('bogus', 'VIEWER')).toBe(false);
});
test('requireOrgRole blocks missing org and low role', () => {
  const run = (headers) => { const next = jest.fn(); requireOrgRole('ADMIN')({ headers }, {}, next); return next.mock.calls[0][0]; };
  expect(run({})).toBeDefined();
  expect(run({ 'x-user-id': 'u1' })).toBeDefined();
  expect(run({ 'x-user-id': 'u1', 'x-org-id': 'o1', 'x-role': 'MEMBER' })).toBeDefined();
  expect(run({ 'x-user-id': 'u1', 'x-org-id': 'o1', 'x-role': 'ADMIN' })).toBeUndefined();
});
test('requireInternal needs the exact token', () => {
  const run = (h, t = 's3') => { const next = jest.fn(); requireInternal(t)({ headers: h }, {}, next); return next.mock.calls[0][0]; };
  expect(run({})).toBeDefined();
  expect(run({ 'x-internal-token': 'wrong' })).toBeDefined();
  expect(run({ 'x-internal-token': 's3' })).toBeUndefined();
  expect(run({ 'x-internal-token': '' }, '')).toBeDefined();
});
