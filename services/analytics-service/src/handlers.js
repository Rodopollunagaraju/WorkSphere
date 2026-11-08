const { applyTaskSnapshot } = require('@worksphere/read-models');
const { describe, entityOf } = require('./stats');

// Group "analytics-group": maintains task/project read models.
function createAnalyticsHandlers({ models }) {
  const { TaskSnapshot, ProjectSnapshot } = models;
  const task = async (e, { session }) => { await applyTaskSnapshot(TaskSnapshot, e, { session }); };
  const proj = (e) => ({ organizationId: e.organizationId, projectId: e.payload.projectId });
  return {
    TASK_CREATED: task, TASK_UPDATED: task, TASK_ASSIGNED: task, TASK_STATUS_CHANGED: task, TASK_COMPLETED: task, TASK_DELETED: task,
    // Creator becomes a member of the project; later membership events keep the list current.
    PROJECT_CREATED: (e, { session }) => ProjectSnapshot.updateOne(proj(e), { $set: { name: e.payload.name, status: 'ACTIVE' }, $addToSet: { members: e.actorId } }, { upsert: true, session }),
    PROJECT_UPDATED: (e, { session }) => (e.payload.name ? ProjectSnapshot.updateOne(proj(e), { $set: { name: e.payload.name } }, { upsert: true, session }) : undefined),
    PROJECT_ARCHIVED: (e, { session }) => ProjectSnapshot.updateOne(proj(e), { $set: { status: 'ARCHIVED' } }, { upsert: true, session }),
    PROJECT_MEMBER_ADDED: (e, { session }) => ProjectSnapshot.updateOne(proj(e), { $addToSet: { members: e.payload.userId } }, { upsert: true, session }),
    PROJECT_MEMBER_REMOVED: (e, { session }) => ProjectSnapshot.updateOne(proj(e), { $pull: { members: e.payload.userId } }, { session }),
  };
}

// Group "activity-group": append-only audit trail of everything that happened.
function createActivityHandlers({ models, eventTypes }) {
  const record = async (e, { session }) => {
    const [entityType, entityId] = entityOf(e);
    await models.ActivityLog.create([{ organizationId: e.organizationId, eventId: e.eventId, eventType: e.eventType, actorId: e.actorId, entityType, entityId, projectId: e.payload.projectId, summary: describe(e), occurredAt: new Date(e.occurredAt) }], { session });
  };
  return Object.fromEntries(eventTypes.map((t) => [t, record]));
}
module.exports = { createAnalyticsHandlers, createActivityHandlers };
