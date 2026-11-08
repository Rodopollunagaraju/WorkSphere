const express = require('express');
const mongoose = require('mongoose');
const { z } = require('zod');
const { validate } = require('@worksphere/validation');
const { asyncHandler, NotFound } = require('@worksphere/errors');
const { requireOrgRole } = require('@worksphere/rbac');
const { keys, presence } = require('@worksphere/redis');

const oid = z.string().refine(mongoose.isValidObjectId, 'Invalid id');

module.exports = function notificationRoutes({ repos, redis }) {
  const r = express.Router();
  const auth = requireOrgRole('VIEWER');
  const N = (req) => repos.notifications.forOrg(req.user.orgId);
  const unreadKey = (req) => keys.unread(req.user.orgId, req.user.id);

  // Redis counter with reconcile-from-DB when the key is missing (eviction/restart).
  async function unreadCount(req) {
    const cached = await redis.get(unreadKey(req));
    if (cached !== null) return Math.max(0, Number(cached));
    const n = await N(req).count({ userId: req.user.id, isRead: false });
    await redis.set(unreadKey(req), n);
    return n;
  }

  const listQuery = z.object({ unread: z.enum(['true', 'false']).optional(), cursor: oid.optional(), limit: z.coerce.number().int().min(1).max(100).default(30) });
  r.get('/notifications', auth, validate(listQuery, 'query'), asyncHandler(async (req, res) => {
    const { unread, cursor, limit } = req.query;
    const filter = { userId: req.user.id, ...(unread === 'true' ? { isRead: false } : {}), ...(cursor ? { _id: { $lt: cursor } } : {}) };
    const rows = await N(req).find(filter, { sort: { _id: -1 }, limit: limit + 1 });
    const hasMore = rows.length > limit; const items = hasMore ? rows.slice(0, limit) : rows;
    res.json({ items, nextCursor: hasMore ? String(items[items.length - 1]._id) : null, unreadCount: await unreadCount(req) });
  }));

  r.get('/notifications/unread-count', auth, asyncHandler(async (req, res) => res.json({ count: await unreadCount(req) })));
  r.get('/notifications/presence', auth, asyncHandler(async (req, res) => res.json({ online: await presence.online(redis, req.user.orgId) })));

  r.post('/notifications/read-all', auth, asyncHandler(async (req, res) => {
    await N(req).updateMany({ userId: req.user.id, isRead: false }, { $set: { isRead: true } });
    await redis.set(unreadKey(req), 0);
    res.json({ count: 0 });
  }));

  r.get('/notifications/preferences', auth, asyncHandler(async (req, res) => {
    const p = await repos.preferences.forOrg(req.user.orgId).findOne({ userId: req.user.id });
    res.json({ email: p ? p.email : true });
  }));
  r.put('/notifications/preferences', auth, validate(z.object({ email: z.boolean() })), asyncHandler(async (req, res) => {
    await repos.preferences.forOrg(req.user.orgId).findOneAndUpdate({ userId: req.user.id }, { $set: { email: req.body.email } }, { upsert: true });
    res.json({ email: req.body.email });
  }));

  r.post('/notifications/:id/read', auth, validate(z.object({ id: oid }), 'params'), asyncHandler(async (req, res) => {
    const was = await N(req).findOneAndUpdate({ _id: req.params.id, userId: req.user.id, isRead: false }, { $set: { isRead: true } });
    if (was) { const left = await redis.decr(unreadKey(req)); if (left < 0) await redis.set(unreadKey(req), 0); return res.json({ read: true, count: Math.max(0, left) }); }
    const exists = await N(req).findOne({ _id: req.params.id, userId: req.user.id });
    if (!exists) throw NotFound('Notification not found');
    res.json({ read: true, count: await unreadCount(req) });
  }));

  return r;
};
