const { keys } = require('@worksphere/redis');

const EMAIL_TYPES = new Set(['TASK_ASSIGNED', 'DEADLINE_REMINDER']);

// Post-commit delivery: Redis unread counter, live Socket.IO push, optional email (respecting preferences).
function createDeliver({ redis, emitToUser, mailer, models, logger = console }) {
  async function maybeEmail(n) {
    if (!mailer || !EMAIL_TYPES.has(n.type)) return;
    const pref = await models.Preference.findOne({ organizationId: n.organizationId, userId: n.userId }).lean();
    if (pref && pref.email === false) return;
    const dir = await models.UserDirectory.findOne({ organizationId: n.organizationId, userId: n.userId }).lean();
    if (!dir || !dir.email) return;
    await mailer.send({ to: dir.email, subject: `WorkSphere: ${n.message}`, text: `${n.message}\n\nOpen WorkSphere to view details.` });
  }
  return async function deliver(notifs) {
    for (const n of notifs) {
      const unread = await redis.incr(keys.unread(n.organizationId, n.userId));
      emitToUser(n.organizationId, n.userId, 'notification', { ...n, _id: String(n._id) });
      emitToUser(n.organizationId, n.userId, 'unread', { count: unread });
      try { await maybeEmail(n); } catch (e) { logger.warn({ err: e.message }, 'email failed'); }
    }
  };
}
module.exports = { createDeliver };
