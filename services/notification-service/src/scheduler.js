const { withLock } = require('@worksphere/redis');
const DAY = 24 * 3600 * 1000;

// Open, assigned tasks that are due within 24h (not yet reminded) or overdue (not yet reminded).
function reminderQuery(now = Date.now()) {
  const at = new Date(now);
  return {
    deleted: false, status: { $ne: 'DONE' }, assignedTo: { $ne: null }, dueDate: { $ne: null, $lte: new Date(now + DAY) },
    $or: [{ reminded24h: false, dueDate: { $gt: at } }, { remindedOverdue: false, dueDate: { $lte: at } }],
  };
}

async function runReminders({ models, deliver, now = Date.now(), limit = 200 }) {
  const { TaskDeadline, Notification } = models;
  const due = await TaskDeadline.find(reminderQuery(now)).limit(limit).lean();
  const created = [];
  for (const t of due) {
    const overdue = +new Date(t.dueDate) <= now;
    const flag = overdue ? 'remindedOverdue' : 'reminded24h';
    // Atomic claim: only the instance that flips the flag sends the reminder (no duplicates).
    const res = await TaskDeadline.updateOne({ _id: t._id, [flag]: false }, { $set: { [flag]: true } });
    if (!(res.modifiedCount === 1 || res.nModified === 1)) continue;
    const msg = overdue ? `Overdue: ${t.title}` : `Due within 24h: ${t.title}`;
    const [n] = await Notification.create([{ organizationId: t.organizationId, userId: t.assignedTo, type: 'DEADLINE_REMINDER', message: msg, data: { taskId: t.taskId, projectId: t.projectId } }]);
    created.push(n.toObject ? n.toObject() : n);
  }
  if (created.length) await deliver(created);
  return created.length;
}

// Every instance ticks, but the Redis lock lets exactly one run per interval.
function startScheduler({ redis, models, deliver, intervalMs = 60000, logger = console }) {
  const tick = async () => {
    try {
      const r = await withLock(redis, 'deadline-reminders', Math.max(intervalMs - 5000, 5000), () => runReminders({ models, deliver }));
      if (r.ran && r.result) logger.info({ sent: r.result }, 'deadline reminders sent');
    } catch (e) { logger.error({ err: e.message }, 'reminder run failed'); }
  };
  const t = setInterval(tick, intervalMs); t.unref(); tick();
  return { stop: () => clearInterval(t) };
}
module.exports = { reminderQuery, runReminders, startScheduler };
