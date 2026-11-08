module.exports = [
  { method: 'GET', path: '/notifications', summary: 'List my notifications (cursor pagination; ?unread=true)', role: 'VIEWER' },
  { method: 'GET', path: '/notifications/unread-count', summary: 'Unread counter (Redis, reconciled from DB)', role: 'VIEWER' },
  { method: 'POST', path: '/notifications/:id/read', summary: 'Mark one as read', role: 'VIEWER' },
  { method: 'POST', path: '/notifications/read-all', summary: 'Mark all as read', role: 'VIEWER' },
  { method: 'GET', path: '/notifications/presence', summary: 'Who is online in my organization', role: 'VIEWER' },
  { method: 'GET', path: '/notifications/preferences', summary: 'Email preference', role: 'VIEWER' },
  { method: 'PUT', path: '/notifications/preferences', summary: 'Update email preference', role: 'VIEWER', body: { email: 'boolean' } },
];
