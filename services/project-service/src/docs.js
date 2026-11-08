module.exports = [
  { method: 'POST', path: '/projects', summary: 'Create project', role: 'ADMIN', body: { name: 'string', description: 'string?', deadline: 'string?' } },
  { method: 'GET', path: '/projects', summary: 'List visible projects (paginated)', role: 'VIEWER' },
  { method: 'GET', path: '/projects/:id', summary: 'Get project (cached)', role: 'VIEWER' },
  { method: 'PATCH', path: '/projects/:id', summary: 'Update project', role: 'ADMIN', body: { name: 'string?', description: 'string?', deadline: 'string?' } },
  { method: 'POST', path: '/projects/:id/archive', summary: 'Archive project', role: 'ADMIN' },
  { method: 'POST', path: '/projects/:id/members', summary: 'Add project member', role: 'ADMIN', body: { userId: 'string' } },
  { method: 'DELETE', path: '/projects/:id/members/:userId', summary: 'Remove project member', role: 'ADMIN' },
];
