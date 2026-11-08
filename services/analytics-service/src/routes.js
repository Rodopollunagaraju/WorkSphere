const express = require('express');
const mongoose = require('mongoose');
const { z } = require('zod');
const { validate } = require('@worksphere/validation');
const { asyncHandler, NotFound } = require('@worksphere/errors');
const { requireOrgRole, atLeast } = require('@worksphere/rbac');
const { buildStats } = require('./stats');

const oid = z.string().refine(mongoose.isValidObjectId, 'Invalid id');

// QUERY SIDE of CQRS: reads only the event-built read models. Every response carries lastUpdatedAt
// so the UI can show how fresh the (eventually consistent) data is.
module.exports = function analyticsRoutes({ repos }) {
  const r = express.Router();
  const auth = requireOrgRole('VIEWER');
  const T = (req) => repos.tasks.forOrg(req.user.orgId);
  const P = (req) => repos.projects.forOrg(req.user.orgId);

  // ADMIN/OWNER see all projects; others only projects they belong to.
  async function visibleProjects(req) {
    const filter = atLeast(req.user.role, 'ADMIN') ? {} : { members: req.user.id };
    return P(req).find(filter, { limit: 1000 });
  }
  async function lastUpdatedAt(req) {
    const [latest] = await T(req).find({}, { sort: { lastEventAt: -1 }, limit: 1, select: 'lastEventAt' });
    return latest ? latest.lastEventAt : null;
  }
  const statusAgg = (req, ids) => T(req).aggregate([{ $match: { deleted: false, projectId: { $in: ids } } }, { $group: { _id: { p: '$projectId', s: '$status' }, n: { $sum: 1 } } }]);
  const overdueAgg = (req, ids) => T(req).aggregate([{ $match: { deleted: false, status: { $ne: 'DONE' }, dueDate: { $lt: new Date() }, projectId: { $in: ids } } }, { $group: { _id: '$projectId', n: { $sum: 1 } } }]);

  async function statsFor(req, projects) {
    const ids = projects.map((p) => p.projectId);
    const [rows, over] = await Promise.all([statusAgg(req, ids), overdueAgg(req, ids)]);
    const by = {}; rows.forEach((x) => { (by[x._id.p] = by[x._id.p] || {})[x._id.s] = x.n; });
    const od = Object.fromEntries(over.map((x) => [x._id, x.n]));
    return projects.map((p) => ({ projectId: p.projectId, name: p.name, status: p.status, ...buildStats(by[p.projectId], od[p.projectId] || 0) }));
  }

  r.get('/analytics/overview', auth, asyncHandler(async (req, res) => {
    const projects = await visibleProjects(req);
    res.json({ projects: await statsFor(req, projects), lastUpdatedAt: await lastUpdatedAt(req) });
  }));

  r.get('/analytics/projects/:projectId', auth, validate(z.object({ projectId: z.string().min(1) }), 'params'), asyncHandler(async (req, res) => {
    const projects = (await visibleProjects(req)).filter((p) => p.projectId === req.params.projectId);
    if (!projects.length) throw NotFound('Project not found');
    const [stats] = await statsFor(req, projects);
    res.json({ ...stats, lastUpdatedAt: await lastUpdatedAt(req) });
  }));

  const scoped = z.object({ projectId: z.string().min(1).optional() });
  async function scopeIds(req, projectId = req.query.projectId) {
    const visible = (await visibleProjects(req)).map((p) => p.projectId);
    if (projectId) { if (!visible.includes(projectId)) throw NotFound('Project not found'); return [projectId]; }
    return visible;
  }

  r.get('/analytics/workload', auth, validate(scoped, 'query'), asyncHandler(async (req, res) => {
    const ids = await scopeIds(req);
    const now = new Date();
    const rows = await T(req).aggregate([
      { $match: { deleted: false, status: { $ne: 'DONE' }, assignedTo: { $ne: null }, projectId: { $in: ids } } },
      { $group: { _id: '$assignedTo', open: { $sum: 1 }, inProgress: { $sum: { $cond: [{ $eq: ['$status', 'IN_PROGRESS'] }, 1, 0] } }, overdue: { $sum: { $cond: [{ $and: [{ $ne: ['$dueDate', null] }, { $lt: ['$dueDate', now] }] }, 1, 0] } } } },
      { $sort: { open: -1 } },
    ]);
    res.json({ workload: rows.map((x) => ({ userId: x._id, open: x.open, inProgress: x.inProgress, overdue: x.overdue })), lastUpdatedAt: await lastUpdatedAt(req) });
  }));

  r.get('/analytics/overdue', auth, validate(scoped, 'query'), asyncHandler(async (req, res) => {
    const ids = await scopeIds(req);
    const items = await T(req).find({ deleted: false, status: { $ne: 'DONE' }, dueDate: { $lt: new Date() }, projectId: { $in: ids } }, { sort: { dueDate: 1 }, limit: 100 });
    res.json({ items, lastUpdatedAt: await lastUpdatedAt(req) });
  }));

  const actQuery = z.object({ projectId: z.string().optional(), cursor: oid.optional(), limit: z.coerce.number().int().min(1).max(100).default(30) });
  r.get('/analytics/activity', auth, validate(actQuery, 'query'), asyncHandler(async (req, res) => {
    const { cursor, limit, projectId } = req.query;
    const admin = atLeast(req.user.role, 'ADMIN');
    const ids = await scopeIds(req, projectId);
    const filter = { ...(admin && !projectId ? {} : { projectId: { $in: ids } }), ...(cursor ? { _id: { $lt: cursor } } : {}) };
    const rows = await repos.activity.forOrg(req.user.orgId).find(filter, { sort: { _id: -1 }, limit: limit + 1 });
    const hasMore = rows.length > limit; const items = hasMore ? rows.slice(0, limit) : rows;
    res.json({ items, nextCursor: hasMore ? String(items[items.length - 1]._id) : null });
  }));

  return r;
};
