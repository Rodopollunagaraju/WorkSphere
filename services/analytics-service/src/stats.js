const STATUSES = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'];

// Pure: turn { status: count } + overdue count into dashboard numbers.
function buildStats(byStatus = {}, overdue = 0) {
  const counts = Object.fromEntries(STATUSES.map((s) => [s, byStatus[s] || 0]));
  const total = STATUSES.reduce((n, s) => n + counts[s], 0);
  const completed = counts.DONE;
  return { total, completed, pending: total - completed, overdue, byStatus: counts, completionPct: total ? Math.round((completed / total) * 1000) / 10 : 0 };
}

function describe(e) {
  const p = e.payload;
  switch (e.eventType) {
    case 'TASK_CREATED': return `created task "${p.snapshot.title}"`;
    case 'TASK_UPDATED': return `updated task "${p.snapshot.title}" (${Object.keys(p.changes || {}).join(', ')})`;
    case 'TASK_ASSIGNED': return `assigned "${p.snapshot.title}" to ${p.assignedTo}`;
    case 'TASK_STATUS_CHANGED': return `moved "${p.snapshot.title}" from ${p.from} to ${p.to}`;
    case 'TASK_COMPLETED': return `completed "${p.snapshot.title}"`;
    case 'TASK_DELETED': return `deleted task "${p.snapshot.title}"`;
    case 'COMMENT_ADDED': return `commented on "${p.taskTitle || p.taskId}"`;
    case 'PROJECT_CREATED': return `created project "${p.name}"`;
    case 'PROJECT_UPDATED': return `updated project ${p.name || p.projectId}`;
    case 'PROJECT_ARCHIVED': return `archived project ${p.name || p.projectId}`;
    case 'PROJECT_MEMBER_ADDED': return `added ${p.userId} to project ${p.projectName || p.projectId}`;
    case 'PROJECT_MEMBER_REMOVED': return `removed ${p.userId} from a project`;
    case 'MEMBER_INVITED': return `invited ${p.email} as ${p.role}`;
    case 'MEMBER_JOINED': return `${p.name || p.userId} joined as ${p.role}`;
    default: return e.eventType;
  }
}
const entityOf = (e) => (e.payload.taskId ? ['task', e.payload.taskId] : e.payload.projectId ? ['project', e.payload.projectId] : ['member', e.payload.userId || e.payload.email]);

module.exports = { buildStats, describe, entityOf, STATUSES };
