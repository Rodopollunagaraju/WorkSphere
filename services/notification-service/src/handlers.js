const { applyTaskSnapshot } = require('@worksphere/read-models');

const ts = (d) => (d ? +new Date(d) : null);
// Reset reminder flags whenever the due date changes so a rescheduled task is reminded again.
const resetReminders = (existing, doc) => (!existing || ts(existing.dueDate) !== ts(doc.dueDate) ? { reminded24h: false, remindedOverdue: false } : {});

// Handlers write inside the idempotency transaction (ctx.session) and RETURN a function that runs
// after commit (socket push, Redis counter, email), so a retried event never double-notifies.
function createHandlers({ models, deliver, sendInviteEmail }) {
  const { Notification, UserDirectory, TaskDeadline } = models;
  const item = (e, userId, type, message, data = {}) => ({ organizationId: e.organizationId, userId, type, message, data });

  async function notify(session, items) {
    if (!items.length) return undefined;
    const created = await Notification.create(items, { session });
    return () => deliver(created.map((d) => (d.toObject ? d.toObject() : d)));
  }
  const snapshot = (e, { session }) => applyTaskSnapshot(TaskDeadline, e, { session, onChange: resetReminders });
  const notOwn = (e, uid) => uid && uid !== e.actorId;

  return {
    TASK_CREATED: async (e, c) => { await snapshot(e, c); },
    TASK_UPDATED: async (e, c) => { await snapshot(e, c); },
    TASK_STATUS_CHANGED: async (e, c) => { await snapshot(e, c); },
    TASK_DELETED: async (e, c) => { await snapshot(e, c); },
    TASK_ASSIGNED: async (e, c) => {
      await snapshot(e, c);
      const { assignedTo, taskId, projectId, snapshot: s } = e.payload;
      return notify(c.session, notOwn(e, assignedTo) ? [item(e, assignedTo, 'TASK_ASSIGNED', `You were assigned: ${s.title}`, { taskId, projectId })] : []);
    },
    TASK_COMPLETED: async (e, c) => {
      await snapshot(e, c);
      const { taskId, projectId, snapshot: s } = e.payload;
      return notify(c.session, notOwn(e, s.createdBy) ? [item(e, s.createdBy, 'TASK_COMPLETED', `Task completed: ${s.title}`, { taskId, projectId })] : []);
    },
    COMMENT_ADDED: async (e, c) => {
      const { mentions, taskId, projectId, taskTitle } = e.payload;
      return notify(c.session, mentions.filter((u) => notOwn(e, u)).map((u) => item(e, u, 'MENTION', `You were mentioned on: ${taskTitle || 'a task'}`, { taskId, projectId })));
    },
    PROJECT_MEMBER_ADDED: async (e, c) => {
      const { userId, projectId, projectName } = e.payload;
      return notify(c.session, notOwn(e, userId) ? [item(e, userId, 'PROJECT_INVITATION', `You were added to project: ${projectName || projectId}`, { projectId })] : []);
    },
    MEMBER_INVITED: async (e) => () => sendInviteEmail(e),
    MEMBER_JOINED: async (e, { session }) => {
      const { userId, email, name } = e.payload;
      await UserDirectory.updateOne({ organizationId: e.organizationId, userId }, { $set: { email, name } }, { upsert: true, session });
    },
  };
}
module.exports = { createHandlers, resetReminders };
