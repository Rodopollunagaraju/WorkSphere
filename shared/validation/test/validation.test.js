const { z } = require('zod');
const { validate } = require('../src');
test('rejects invalid body and passes valid body', () => {
  const mw = validate(z.object({ n: z.number() }));
  const next = jest.fn();
  mw({ body: { n: 'x' } }, {}, next);
  expect(next.mock.calls[0][0].status).toBe(400);
  const ok = jest.fn();
  mw({ body: { n: 1 } }, {}, ok);
  expect(ok).toHaveBeenCalledWith();
});
