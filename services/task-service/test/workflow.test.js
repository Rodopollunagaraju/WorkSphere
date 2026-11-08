const { canTransition, allowedFrom } = require('../src/workflow');
test('workflow allows forward steps, one step back, and reopening', () => {
  expect(canTransition('TODO', 'IN_PROGRESS')).toBe(true);
  expect(canTransition('IN_REVIEW', 'DONE')).toBe(true);
  expect(canTransition('DONE', 'IN_PROGRESS')).toBe(true);
  expect(canTransition('IN_PROGRESS', 'TODO')).toBe(true);
});
test('workflow rejects skipping and nonsense', () => {
  expect(canTransition('TODO', 'DONE')).toBe(false);
  expect(canTransition('TODO', 'IN_REVIEW')).toBe(false);
  expect(canTransition('DONE', 'TODO')).toBe(false);
  expect(canTransition('NOPE', 'TODO')).toBe(false);
  expect(allowedFrom('TODO')).toEqual(['IN_PROGRESS']);
});
