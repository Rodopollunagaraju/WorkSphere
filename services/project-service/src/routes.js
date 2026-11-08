const express = require('express');
const mongoose = require('mongoose');
const { z } = require('zod');
const { validate } = require('@worksphere/validation');
const { asyncHandler, NotFound, BadRequest } = require('@worksphere/errors');
const { requireOrgRole, requireInternal } = require('@worksphere/rbac');
const { createEvent } = require('@worksphere/event-contracts');
const { cacheAside, keys } = require('@worksphere/redis');
const { visibleFilter, canSee } = require('./access');

const oid = z.string().refine(mongoose.isValidObjectId, 'Invalid id');
const idParam = z.object({ id: oid });

module.exports = function projectRoutes({ repo, outbox, redis, authClient, tx, metrics, internalToken }) {
  const r = express.Router();
  const hooks = metrics ? metrics.cacheHooks('project') : {};
  const ev = (req, eventType, payload) => createEvent({ eventType, organizationId: req.user.orgId, actorId: req.user.id, correlationId: req.correlationId, payload });
  const invalidate = (org, id) => redis.del(keys.project(org, id));

  async function assertOrgMembers(org, userIds) {
    for (const uid of userIds) {
      let m;
      try { m = await authClient.get(`/internal/orgs/${org}/members/${uid}`); } catch (e) { if (e.status) throw BadRequest('Could not verify member'); throw e; }
      if (!m.isMember) throw BadRequest(`User ${uid} is not a member of this organization`);
    }
  }
  async function loadVisible(req) {
    const org = req.user.orgId;
    const project = await cacheAside(redis, keys.project(org, req.params.id), 300, () => repo.forOrg(org).findById(req.params.id), hooks);
    if (!project || !canSee(req.user, project)) throw NotFound('Project not found'); // 404, never reveal existence
    return project;
  }

  const createBody = z.object({ name: z.string().min(1).max(120), description: z.string().max(2000).optional(), deadline: z.string().datetime().optional(), members: z.array(z.string()).max(100).optional() });
  r.post('/projects', requireOrgRole('ADMIN'), validate(createBody), asyncHandler(async (req, res) => {
    const org = req.user.orgId;
    const extra = [...new Set(req.body.members || [])].filter((m) => m !== req.user.id);
    await assertOrgMembers(org, extra);
    const project = await tx(async (session) => {
      const p = await repo.forOrg(org).create({ name: req.body.name, description: req.body.description || '', deadline: req.body.deadline ? new Date(req.body.deadline) : undefined, createdBy: req.user.id, members: [req.user.id, ...extra] }, { session });
      const pid = String(p._id);
      await outbox.enqueue(ev(req, 'PROJECT_CREATED', { projectId: pid, name: p.name }), { session });
      for (const uid of extra) await outbox.enqueue(ev(req, 'PROJECT_MEMBER_ADDED', { projectId: pid, userId: uid, projectName: p.name }), { session });
      return p;
    });
    res.status(201).json({ project });
  }));

  const listQuery = z.object({ status: z.enum(['ACTIVE', 'ARCHIVED']).optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) });
  r.get('/projects', requireOrgRole('VIEWER'), validate(listQuery, 'query'), asyncHandler(async (req, res) => {
    const scoped = repo.forOrg(req.user.orgId);
    const filter = { ...visibleFilter(req.user), ...(req.query.status ? { status: req.query.status } : {}) };
    const { page, limit } = req.query;
    const [items, total] = await Promise.all([scoped.find(filter, { sort: { createdAt: -1 }, skip: (page - 1) * limit, limit }), scoped.count(filter)]);
    res.json({ items, total, page, limit });
  }));

  r.get('/projects/:id', requireOrgRole('VIEWER'), validate(idParam, 'params'), asyncHandler(async (req, res) => {
    res.json({ project: await loadVisible(req) });
  }));

  const patchBody = z.object({ name: z.string().min(1).max(120).optional(), description: z.string().max(2000).optional(), deadline: z.string().datetime().nullable().optional() }).refine((b) => Object.keys(b).length > 0, 'Nothing to update');
  r.patch('/projects/:id', requireOrgRole('ADMIN'), validate(idParam, 'params'), validate(patchBody), asyncHandler(async (req, res) => {
    const org = req.user.orgId;
    const set = { ...req.body, ...(req.body.deadline ? { deadline: new Date(req.body.deadline) } : {}) };
    const project = await tx(async (session) => {
      const p = await repo.forOrg(org).findOneAndUpdate({ _id: req.params.id }, { $set: set }, { session });
      if (!p) throw NotFound('Project not found');
      await outbox.enqueue(ev(req, 'PROJECT_UPDATED', { projectId: req.params.id, name: p.name, changes: req.body }), { session });
      return p;
    });
    await invalidate(org, req.params.id);
    res.json({ project });
  }));

  r.post('/projects/:id/archive', requireOrgRole('ADMIN'), validate(idParam, 'params'), asyncHandler(async (req, res) => {
    const org = req.user.orgId;
    const project = await tx(async (session) => {
      const p = await repo.forOrg(org).findOneAndUpdate({ _id: req.params.id }, { $set: { status: 'ARCHIVED' } }, { session });
      if (!p) throw NotFound('Project not found');
      await outbox.enqueue(ev(req, 'PROJECT_ARCHIVED', { projectId: req.params.id, name: p.name }), { session });
      return p;
    });
    await invalidate(org, req.params.id);
    res.json({ project });
  }));

  r.post('/projects/:id/members', requireOrgRole('ADMIN'), validate(idParam, 'params'), validate(z.object({ userId: z.string().min(1) })), asyncHandler(async (req, res) => {
    const org = req.user.orgId;
    await assertOrgMembers(org, [req.body.userId]);
    const project = await tx(async (session) => {
      const p = await repo.forOrg(org).findOneAndUpdate({ _id: req.params.id }, { $addToSet: { members: req.body.userId } }, { session });
      if (!p) throw NotFound('Project not found');
      await outbox.enqueue(ev(req, 'PROJECT_MEMBER_ADDED', { projectId: req.params.id, userId: req.body.userId, projectName: p.name }), { session });
      return p;
    });
    await invalidate(org, req.params.id);
    res.status(201).json({ project });
  }));

  r.delete('/projects/:id/members/:userId', requireOrgRole('ADMIN'), validate(z.object({ id: oid, userId: z.string().min(1) }), 'params'), asyncHandler(async (req, res) => {
    const org = req.user.orgId;
    await tx(async (session) => {
      const p = await repo.forOrg(org).findOneAndUpdate({ _id: req.params.id }, { $pull: { members: req.params.userId } }, { session });
      if (!p) throw NotFound('Project not found');
      await outbox.enqueue(ev(req, 'PROJECT_MEMBER_REMOVED', { projectId: req.params.id, userId: req.params.userId }), { session });
    });
    await invalidate(org, req.params.id);
    res.status(204).end();
  }));

  // Internal (not routed by the gateway): used by Task service to verify project membership.
  r.get('/internal/projects/:id/membership/:userId', requireInternal(internalToken), asyncHandler(async (req, res) => {
    const org = req.headers['x-org-id'];
    if (!org || !mongoose.isValidObjectId(req.params.id)) return res.json({ exists: false, isMember: false, status: null });
    const p = await repo.forOrg(String(org)).findById(req.params.id);
    res.json({ exists: Boolean(p), status: p ? p.status : null, isMember: Boolean(p && p.members.includes(req.params.userId)) });
  }));

  return r;
};
