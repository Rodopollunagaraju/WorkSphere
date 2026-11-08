const express = require('express');
const mongoose = require('mongoose');
const { z } = require('zod');
const { validate } = require('@worksphere/validation');
const { asyncHandler, NotFound, Conflict, BadRequest, Forbidden, AppError } = require('@worksphere/errors');
const { requireOrgRole, atLeast } = require('@worksphere/rbac');
const { createEvent } = require('@worksphere/event-contracts');
const { cacheAside, keys, getVersion, bumpVersion, hashOf } = require('@worksphere/redis');
const { canTransition, allowedFrom, STATUSES } = require('./workflow');
const { buildKey, keyBelongs, MAX_BYTES, ALLOWED } = require('./storage');

const oid = z.string().refine(mongoose.isValidObjectId, 'Invalid id');
const idParam = z.object({ id: oid });
const priority = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
const iso = z.string().datetime();

const snap = (t) => ({ title: t.title, status: t.status, assignedTo: t.assignedTo || null, priority: t.priority, dueDate: t.dueDate ? new Date(t.dueDate).toISOString() : null, createdBy: t.createdBy, version: t.version });
const MENTION = /@([a-f0-9]{24})/g;
const parseMentions = (text) => [...new Set([...text.matchAll(MENTION)].map((m) => m[1]))];

module.exports = function taskRoutes({ repos, outbox, redis, projectClient, tx, storage, metrics }) {
  const r = express.Router();
  const hooks = metrics ? { ...metrics.cacheHooks('tasklist') } : {};
  const pmHooks = metrics ? { ...metrics.cacheHooks('membership') } : {};
  const ev = (req, eventType, payload) => createEvent({ eventType, organizationId: req.user.orgId, actorId: req.user.id, correlationId: req.correlationId, payload });
  const bumpList = (org, projectId) => bumpVersion(redis, keys.taskListVersion(org, projectId));

  // ---- project access (cached membership lookups through a circuit breaker) ----
  async function projectAccess(org, projectId, userId) {
    return cacheAside(redis, keys.membership(org, projectId, userId), 60, async () => {
      try { return await projectClient.get(`/internal/projects/${projectId}/membership/${userId}`, { 'x-org-id': org }); } catch (e) {
        if (e.code === 'EOPENBREAKER') throw new AppError(503, 'UPSTREAM_UNAVAILABLE', 'Project service unavailable, try again shortly');
        throw e;
      }
    }, pmHooks);
  }
  async function assertProject(req, projectId, { write = false } = {}) {
    const a = await projectAccess(req.user.orgId, projectId, req.user.id);
    if (!a.exists || (!a.isMember && !atLeast(req.user.role, 'ADMIN'))) throw NotFound('Project not found');
    if (write && a.status === 'ARCHIVED') throw BadRequest('Project is archived');
  }
  async function assertAssignee(req, projectId, userId) {
    const a = await projectAccess(req.user.orgId, projectId, userId);
    if (!a.exists || !a.isMember) throw BadRequest('Assignee must be a member of the project');
  }
  async function loadTask(req, opts) {
    const t = await repos.tasks.forOrg(req.user.orgId).findById(req.params.id);
    if (!t) throw NotFound('Task not found');
    await assertProject(req, t.projectId, opts);
    return t;
  }

  // ---- optimistic concurrency: update only if the caller saw the current version ----
  async function applyUpdate(org, id, expectedVersion, set, session) {
    const scoped = repos.tasks.forOrg(org);
    const updated = await scoped.findOneAndUpdate({ _id: id, version: expectedVersion }, { $set: set, $inc: { version: 1 } }, { session });
    if (updated) return updated;
    const current = await scoped.findById(id, { session });
    if (!current) throw NotFound('Task not found');
    throw Conflict('Task was modified by someone else', { current });
  }
  const history = (req, session, taskId, changes) => repos.history.forOrg(req.user.orgId).create(changes.map((c) => ({ taskId, actorId: req.user.id, field: c.field, oldValue: c.old, newValue: c.new })), { session });

  // ---- create ----
  const createBody = z.object({ projectId: z.string().min(1), title: z.string().min(1).max(200), description: z.string().max(10000).optional(), assignedTo: z.string().min(1).nullable().optional(), priority: priority.default('MEDIUM'), dueDate: iso.nullable().optional(), labels: z.array(z.string().max(30)).max(20).default([]) });
  r.post('/tasks', requireOrgRole('MEMBER'), validate(createBody), asyncHandler(async (req, res) => {
    const org = req.user.orgId; const b = req.body;
    await assertProject(req, b.projectId, { write: true });
    if (b.assignedTo) await assertAssignee(req, b.projectId, b.assignedTo);
    const task = await tx(async (session) => {
      const t = await repos.tasks.forOrg(org).create({ projectId: b.projectId, title: b.title, description: b.description || '', assignedTo: b.assignedTo || null, priority: b.priority, status: 'TODO', dueDate: b.dueDate ? new Date(b.dueDate) : null, createdBy: req.user.id, labels: b.labels, version: 1 }, { session });
      const base = { taskId: String(t._id), projectId: b.projectId };
      await history(req, session, base.taskId, [{ field: 'created', old: null, new: t.title }]);
      await outbox.enqueue(ev(req, 'TASK_CREATED', { ...base, snapshot: snap(t) }), { session });
      if (t.assignedTo) await outbox.enqueue(ev(req, 'TASK_ASSIGNED', { ...base, assignedTo: t.assignedTo, previousAssignee: null, snapshot: snap(t) }), { session });
      return t;
    });
    await bumpList(org, b.projectId);
    res.status(201).json({ task });
  }));

  // ---- list (cursor pagination; cached per filter set, invalidated by a per-project version bump) ----
  const listQuery = z.object({ projectId: z.string().min(1), status: z.enum(STATUSES).optional(), assignedTo: z.string().optional(), priority: priority.optional(), dueBefore: iso.optional(), cursor: oid.optional(), limit: z.coerce.number().int().min(1).max(100).default(25) });
  r.get('/tasks', requireOrgRole('VIEWER'), validate(listQuery, 'query'), asyncHandler(async (req, res) => {
    const org = req.user.orgId; const { projectId, limit, cursor, dueBefore, ...rest } = req.query;
    await assertProject(req, projectId);
    const ver = await getVersion(redis, keys.taskListVersion(org, projectId));
    const key = keys.taskList(org, projectId, ver, hashOf(req.query));
    const data = await cacheAside(redis, key, 120, async () => {
      const filter = { projectId, ...rest, ...(cursor ? { _id: { $lt: cursor } } : {}), ...(dueBefore ? { dueDate: { $lte: new Date(dueBefore) } } : {}) };
      const rows = await repos.tasks.forOrg(org).find(filter, { sort: { _id: -1 }, limit: limit + 1 });
      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      return { items, nextCursor: hasMore ? String(items[items.length - 1]._id) : null };
    }, hooks);
    res.json(data);
  }));

  r.get('/tasks/:id', requireOrgRole('VIEWER'), validate(idParam, 'params'), asyncHandler(async (req, res) => res.json({ task: await loadTask(req) })));

  // ---- update (requires the version the client last saw) ----
  const patchBody = z.object({ version: z.number().int().min(1), title: z.string().min(1).max(200).optional(), description: z.string().max(10000).optional(), priority: priority.optional(), dueDate: iso.nullable().optional(), labels: z.array(z.string().max(30)).max(20).optional() });
  r.patch('/tasks/:id', requireOrgRole('MEMBER'), validate(idParam, 'params'), validate(patchBody), asyncHandler(async (req, res) => {
    const org = req.user.orgId; const { version, ...fields } = req.body;
    const cur = await loadTask(req, { write: true });
    const set = {}; const changes = [];
    for (const [f, v] of Object.entries(fields)) {
      const next = f === 'dueDate' ? (v ? new Date(v) : null) : v;
      if (JSON.stringify(next) !== JSON.stringify(cur[f])) { set[f] = next; changes.push({ field: f, old: cur[f] ?? null, new: next }); }
    }
    if (!changes.length) return res.json({ task: cur, unchanged: true });
    const task = await tx(async (session) => {
      const u = await applyUpdate(org, req.params.id, version, set, session);
      await history(req, session, req.params.id, changes);
      await outbox.enqueue(ev(req, 'TASK_UPDATED', { taskId: req.params.id, projectId: cur.projectId, changes: Object.fromEntries(changes.map((c) => [c.field, c.new])), snapshot: snap(u) }), { session });
      return u;
    });
    await bumpList(org, cur.projectId);
    res.json({ task });
  }));

  r.delete('/tasks/:id', requireOrgRole('MEMBER'), validate(idParam, 'params'), asyncHandler(async (req, res) => {
    const org = req.user.orgId;
    const cur = await loadTask(req, { write: true });
    if (!atLeast(req.user.role, 'ADMIN') && cur.createdBy !== req.user.id) throw Forbidden('Only the creator or an admin can delete a task');
    await tx(async (session) => {
      await repos.tasks.forOrg(org).deleteOne({ _id: req.params.id }, { session });
      await repos.comments.forOrg(org).deleteMany({ taskId: req.params.id }, { session });
      await history(req, session, req.params.id, [{ field: 'deleted', old: cur.title, new: null }]);
      await outbox.enqueue(ev(req, 'TASK_DELETED', { taskId: req.params.id, projectId: cur.projectId, snapshot: { ...snap(cur), version: cur.version + 1 } }), { session });
    });
    await bumpList(org, cur.projectId);
    res.status(204).end();
  }));

  // ---- assign ----
  r.post('/tasks/:id/assign', requireOrgRole('MEMBER'), validate(idParam, 'params'), validate(z.object({ assignedTo: z.string().min(1).nullable(), version: z.number().int().min(1).optional() })), asyncHandler(async (req, res) => {
    const org = req.user.orgId; const cur = await loadTask(req, { write: true });
    if (req.body.assignedTo) await assertAssignee(req, cur.projectId, req.body.assignedTo);
    const task = await tx(async (session) => {
      const u = await applyUpdate(org, req.params.id, req.body.version ?? cur.version, { assignedTo: req.body.assignedTo }, session);
      await history(req, session, req.params.id, [{ field: 'assignedTo', old: cur.assignedTo, new: req.body.assignedTo }]);
      const base = { taskId: req.params.id, projectId: cur.projectId, snapshot: snap(u) };
      if (req.body.assignedTo) await outbox.enqueue(ev(req, 'TASK_ASSIGNED', { ...base, assignedTo: req.body.assignedTo, previousAssignee: cur.assignedTo }), { session });
      else await outbox.enqueue(ev(req, 'TASK_UPDATED', { ...base, changes: { assignedTo: null } }), { session });
      return u;
    });
    await bumpList(org, cur.projectId);
    res.json({ task });
  }));

  // ---- status workflow ----
  r.post('/tasks/:id/status', requireOrgRole('MEMBER'), validate(idParam, 'params'), validate(z.object({ status: z.enum(STATUSES), version: z.number().int().min(1).optional() })), asyncHandler(async (req, res) => {
    const org = req.user.orgId; const cur = await loadTask(req, { write: true }); const to = req.body.status;
    if (!canTransition(cur.status, to)) throw BadRequest(`Cannot move from ${cur.status} to ${to}`, { allowed: allowedFrom(cur.status) });
    const task = await tx(async (session) => {
      const u = await applyUpdate(org, req.params.id, req.body.version ?? cur.version, { status: to }, session);
      await history(req, session, req.params.id, [{ field: 'status', old: cur.status, new: to }]);
      const base = { taskId: req.params.id, projectId: cur.projectId, snapshot: snap(u) };
      await outbox.enqueue(ev(req, 'TASK_STATUS_CHANGED', { ...base, from: cur.status, to }), { session });
      if (to === 'DONE') await outbox.enqueue(ev(req, 'TASK_COMPLETED', base), { session });
      return u;
    });
    await bumpList(org, cur.projectId);
    res.json({ task });
  }));

  // ---- comments & history ----
  r.post('/tasks/:id/comments', requireOrgRole('MEMBER'), validate(idParam, 'params'), validate(z.object({ body: z.string().min(1).max(5000) })), asyncHandler(async (req, res) => {
    const cur = await loadTask(req, { write: true }); const mentions = parseMentions(req.body.body);
    const comment = await tx(async (session) => {
      const c = await repos.comments.forOrg(req.user.orgId).create({ taskId: req.params.id, authorId: req.user.id, body: req.body.body, mentions }, { session });
      await outbox.enqueue(ev(req, 'COMMENT_ADDED', { taskId: req.params.id, projectId: cur.projectId, commentId: String(c._id), mentions, taskTitle: cur.title }), { session });
      return c;
    });
    res.status(201).json({ comment });
  }));
  r.get('/tasks/:id/comments', requireOrgRole('VIEWER'), validate(idParam, 'params'), asyncHandler(async (req, res) => {
    await loadTask(req);
    res.json({ comments: await repos.comments.forOrg(req.user.orgId).find({ taskId: req.params.id }, { sort: { createdAt: 1 }, limit: 500 }) });
  }));
  r.get('/tasks/:id/history', requireOrgRole('VIEWER'), validate(idParam, 'params'), asyncHandler(async (req, res) => {
    await loadTask(req);
    res.json({ history: await repos.history.forOrg(req.user.orgId).find({ taskId: req.params.id }, { sort: { createdAt: 1 }, limit: 500 }) });
  }));

  // ---- attachments: client uploads straight to object storage via presigned URL ----
  const presignBody = z.object({ fileName: z.string().min(1).max(200), contentType: z.string().refine((c) => ALLOWED.has(c), 'File type not allowed'), size: z.number().int().min(1).max(MAX_BYTES) });
  r.post('/tasks/:id/attachments/presign', requireOrgRole('MEMBER'), validate(idParam, 'params'), validate(presignBody), asyncHandler(async (req, res) => {
    await loadTask(req, { write: true });
    const key = buildKey(req.user.orgId, req.params.id, req.body.fileName);
    const att = await repos.attachments.forOrg(req.user.orgId).create({ taskId: req.params.id, key, fileName: req.body.fileName, size: req.body.size, contentType: req.body.contentType, uploadedBy: req.user.id });
    res.status(201).json({ attachmentId: att._id, uploadUrl: await storage.presignPut(key, req.body.contentType), expiresInSeconds: 300 });
  }));
  r.post('/tasks/:id/attachments/:attId/confirm', requireOrgRole('MEMBER'), validate(z.object({ id: oid, attId: oid }), 'params'), asyncHandler(async (req, res) => {
    await loadTask(req, { write: true });
    const scoped = repos.attachments.forOrg(req.user.orgId);
    const att = await scoped.findOne({ _id: req.params.attId, taskId: req.params.id });
    if (!att || !keyBelongs(att.key, req.user.orgId, req.params.id)) throw NotFound('Attachment not found');
    let head; try { head = await storage.head(att.key); } catch { throw BadRequest('Upload not found in storage'); }
    if (head.size > MAX_BYTES) throw BadRequest('File too large');
    res.json({ attachment: await scoped.findOneAndUpdate({ _id: att._id }, { $set: { confirmed: true, size: head.size } }) });
  }));
  r.get('/tasks/:id/attachments', requireOrgRole('VIEWER'), validate(idParam, 'params'), asyncHandler(async (req, res) => {
    await loadTask(req);
    res.json({ attachments: await repos.attachments.forOrg(req.user.orgId).find({ taskId: req.params.id, confirmed: true }, { sort: { createdAt: 1 } }) });
  }));
  r.get('/tasks/:id/attachments/:attId/download', requireOrgRole('VIEWER'), validate(z.object({ id: oid, attId: oid }), 'params'), asyncHandler(async (req, res) => {
    await loadTask(req);
    const att = await repos.attachments.forOrg(req.user.orgId).findOne({ _id: req.params.attId, taskId: req.params.id, confirmed: true });
    if (!att || !keyBelongs(att.key, req.user.orgId, req.params.id)) throw NotFound('Attachment not found');
    res.json({ downloadUrl: await storage.presignGet(att.key, att.fileName) });
  }));

  return r;
};
