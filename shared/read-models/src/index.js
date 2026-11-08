// Version-guarded upsert of a task snapshot from a TASK_* event. Replaying or reordering events
// can never move a task backwards: an event only applies if its task version is newer.
// `onChange(existing, doc)` may return extra $set fields (e.g. reset reminder flags).
async function applyTaskSnapshot(Model, event, { session, onChange } = {}) {
  const { taskId, projectId, snapshot: s } = event.payload;
  const existing = await Model.findOne({ organizationId: event.organizationId, taskId }).session(session || null).lean();
  if (existing && existing.version >= s.version) return false;
  const doc = {
    projectId, title: s.title, status: s.status, assignedTo: s.assignedTo || null, priority: s.priority || 'MEDIUM',
    dueDate: s.dueDate ? new Date(s.dueDate) : null, createdBy: s.createdBy || null, version: s.version,
    deleted: event.eventType === 'TASK_DELETED', lastEventAt: new Date(event.occurredAt),
  };
  const extra = onChange ? onChange(existing, doc) || {} : {};
  await Model.updateOne({ organizationId: event.organizationId, taskId }, { $set: { ...doc, ...extra }, $setOnInsert: { taskId, organizationId: event.organizationId } }, { upsert: true, session });
  return true;
}
module.exports = { applyTaskSnapshot };
