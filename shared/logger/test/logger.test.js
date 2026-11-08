const { runWithContext, getContext } = require('../src');
test('context is available inside runWithContext only', () => {
  expect(getContext().correlationId).toBeUndefined();
  runWithContext({ correlationId: 'abc' }, () => expect(getContext().correlationId).toBe('abc'));
});
