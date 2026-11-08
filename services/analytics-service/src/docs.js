module.exports = [
  { method: 'GET', path: '/analytics/overview', summary: 'Per-project totals, pending, overdue, completion % (read model)', role: 'VIEWER' },
  { method: 'GET', path: '/analytics/projects/:projectId', summary: 'One project dashboard', role: 'VIEWER' },
  { method: 'GET', path: '/analytics/workload', summary: 'Open tasks per employee (?projectId=)', role: 'VIEWER' },
  { method: 'GET', path: '/analytics/overdue', summary: 'Overdue tasks (?projectId=)', role: 'VIEWER' },
  { method: 'GET', path: '/analytics/activity', summary: 'Activity feed (cursor pagination)', role: 'VIEWER' },
];
