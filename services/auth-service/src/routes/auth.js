const crypto = require('node:crypto');
const argon2 = require('argon2');
const express = require('express');
const mongoose = require('mongoose');
const { z } = require('zod');
const { validate } = require('@worksphere/validation');
const { asyncHandler, Unauthorized, NotFound, Conflict, Forbidden, BadRequest } = require('@worksphere/errors');
const { createEvent } = require('@worksphere/event-contracts');
const { withTransaction } = require('@worksphere/outbox');
const { keys } = require('@worksphere/redis');
const { User, Organization, Membership } = require('../models');
const { signAccess } = require('../tokens');
const { requireUser, requireOrgRole } = require('../rbac');

const email = z.string().email().max(254);
const password = z.string().min(8).max(128);

module.exports = function authRoutes({ tokenStore, outbox, redis }) {
  const r = express.Router();

  async function sessionFor(user, orgId) {
    let claims = { userId: String(user._id) };
    if (orgId) {
      const m = await Membership.findOne({ userId: user._id, organizationId: orgId });
      if (!m) throw Forbidden('Not a member of this organization');
      const org = await Organization.findById(orgId);
      claims = { ...claims, orgId: String(orgId), role: m.role, plan: org.plan };
    }
    return signAccess(claims);
  }
  const userView = (u) => ({ id: u._id, name: u.name, email: u.email });

  r.post('/register', validate(z.object({ name: z.string().min(1).max(100), email, password })),
    asyncHandler(async (req, res) => {
      if (await User.exists({ email: req.body.email.toLowerCase() })) throw Conflict('Email already registered');
      const user = await User.create({ name: req.body.name, email: req.body.email, passwordHash: await argon2.hash(req.body.password) });
      res.status(201).json({ user: userView(user), accessToken: await sessionFor(user), refreshToken: await tokenStore.issue(String(user._id)) });
    }));

  r.post('/login', validate(z.object({ email, password })),
    asyncHandler(async (req, res) => {
      const user = await User.findOne({ email: req.body.email.toLowerCase() });
      // identical error for unknown email and wrong password
      if (!user || !(await argon2.verify(user.passwordHash, req.body.password))) throw Unauthorized('Invalid credentials');
      res.json({ user: userView(user), accessToken: await sessionFor(user), refreshToken: await tokenStore.issue(String(user._id)) });
    }));

  r.post('/refresh', validate(z.object({ refreshToken: z.string(), orgId: z.string().optional() })),
    asyncHandler(async (req, res) => {
      const { userId, refreshToken } = await tokenStore.rotate(req.body.refreshToken);
      const user = await User.findById(userId);
      if (!user) throw Unauthorized('User no longer exists');
      res.json({ accessToken: await sessionFor(user, req.body.orgId), refreshToken });
    }));

  r.post('/logout', validate(z.object({ refreshToken: z.string() })),
    asyncHandler(async (req, res) => { await tokenStore.revoke(req.body.refreshToken); res.status(204).end(); }));

  r.get('/me', requireUser, asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id).select('name email');
    if (!user) throw NotFound('User not found');
    res.json({ user, orgId: req.user.orgId, role: req.user.role });
  }));

  // ----- sessions (Redis-backed) -----
  r.get('/sessions', requireUser, asyncHandler(async (req, res) => {
    const families = await tokenStore.listSessions(req.user.id);
    res.json({ count: families.length, sessions: families.map((f) => ({ id: f })) });
  }));
  r.delete('/sessions', requireUser, asyncHandler(async (req, res) => {
    res.json({ revoked: await tokenStore.revokeAll(req.user.id) });
  }));

  // ----- organizations -----
  r.post('/organizations', requireUser, validate(z.object({ name: z.string().min(2).max(100) })),
    asyncHandler(async (req, res) => {
      const user = await User.findById(req.user.id);
      if (!user) throw Unauthorized('User no longer exists');
      const slug = `${req.body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${crypto.randomBytes(3).toString('hex')}`;
      const org = await withTransaction(mongoose, async (session) => {
        const [o] = await Organization.create([{ name: req.body.name, slug, ownerId: req.user.id }], { session });
        await Membership.create([{ organizationId: o._id, userId: req.user.id, role: 'OWNER' }], { session });
        await outbox.enqueue(createEvent({ eventType: 'MEMBER_JOINED', organizationId: String(o._id), actorId: req.user.id, correlationId: req.correlationId, payload: { userId: req.user.id, role: 'OWNER', email: user.email, name: user.name } }), { session });
        return o;
      });
      await redis.set(keys.orgPlan(String(org._id)), org.plan);
      res.status(201).json({ organization: org });
    }));

  r.get('/organizations', requireUser, asyncHandler(async (req, res) => {
    const memberships = await Membership.find({ userId: req.user.id }).populate('organizationId');
    res.json({ organizations: memberships.filter((m) => m.organizationId).map((m) => ({ id: m.organizationId._id, name: m.organizationId.name, plan: m.organizationId.plan, role: m.role })) });
  }));

  // Issues an org-scoped access token after verifying membership server-side.
  r.post('/switch-org', requireUser, validate(z.object({ orgId: z.string() })),
    asyncHandler(async (req, res) => {
      if (!mongoose.isValidObjectId(req.body.orgId)) throw BadRequest('Invalid orgId');
      res.json({ accessToken: await sessionFor(await User.findById(req.user.id), req.body.orgId) });
    }));

  // Plan change (billing is out of scope). Redis is updated so the gateway rate limiter sees it immediately.
  r.patch('/organizations/plan', requireOrgRole('OWNER'),
    validate(z.object({ plan: z.enum(['FREE', 'PRO', 'ENTERPRISE']), rateLimit: z.number().int().min(1).max(1000000).optional() })),
    asyncHandler(async (req, res) => {
      const org = await Organization.findByIdAndUpdate(req.user.orgId, { plan: req.body.plan }, { new: true });
      if (!org) throw NotFound('Organization not found');
      await redis.set(keys.orgPlan(req.user.orgId), org.plan);
      if (org.plan === 'ENTERPRISE' && req.body.rateLimit) await redis.set(keys.orgLimit(req.user.orgId), String(req.body.rateLimit));
      else await redis.del(keys.orgLimit(req.user.orgId));
      res.json({ plan: org.plan, rateLimit: org.plan === 'ENTERPRISE' ? req.body.rateLimit || null : null });
    }));

  return r;
};
