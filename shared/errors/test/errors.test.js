const { Conflict, NotFound, errorHandler } = require('../src');
test('error classes carry status and code', () => {
  expect(Conflict().status).toBe(409);
  expect(NotFound().code).toBe('NOT_FOUND');
});
test('handler hides internals for unknown errors', () => {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  errorHandler({ error() {} })(new Error('secret'), {}, res, () => {});
  expect(res.status).toHaveBeenCalledWith(500);
  expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('secret');
});
