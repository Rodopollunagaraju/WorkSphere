const { buildSpec } = require('../src');
test('converts :params, security and body schema', () => {
  const s = buildSpec({ title: 'T', prefix: '/api', routes: [
    { method: 'POST', path: '/tasks/:id/assign', summary: 'x', role: 'MEMBER', body: { assignedTo: 'string', note: 'string?' } },
    { method: 'POST', path: '/login', summary: 'l', public: true },
  ] });
  const op = s.paths['/api/tasks/{id}/assign'].post;
  expect(op.parameters[0].name).toBe('id');
  expect(op.requestBody.content['application/json'].schema.required).toEqual(['assignedTo']);
  expect(s.paths['/api/login'].post.security).toEqual([]);
});
