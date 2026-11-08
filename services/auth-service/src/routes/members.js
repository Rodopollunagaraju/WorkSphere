const crypto = require('node:crypto');
const express = require('express');
const mongoose = require('mongoose');
const { z } = require('zod');
const { validate } = require('@worksphere/validation');
const { asyncHandler, NotFound, Conflict, Forbidden, BadRequest } = require('@worksphere/errors');
const { createEvent } = require('@worksphere/event-contracts');
const { withTransaction } = require('@worksphere/outbox');
const { Membership, Invite, User } = require('../models');
const { requireUser, requireOrgRole, ROLES, atLeast } = require('../rbac');
const cfg = require('../config');

const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');
const objectId = z.string().refine(mongoose.isValidObjectId, 'Invalid id');

module.exports = function memberRoutes({ outbox }) {
  const r = express.Router();

  r.get('/members', requireOrgRole('VIEWER'), asyncHandler(async (req, res) => {
    const ms = await Membership.find({ organizationId: req.user.orgId }).populate('userId', 'name email');
    res.json({ members: ms.map((m) => ({ userId: m.userId._id, name: m.userId.name, email: m.userId.email, role: m.role })) });
  }));

  // The token is emitted in MEMBER_INVITED so Notification can email the link (and returned here for dev/testing).
  r.post('/invites', requireOrgRole('ADMIN'),
    validate(z.object({ email: z.string().email(), role: z.enum(ROLES.filter((x) => x !== 'OWNER')) })),
    asyncHandler(async (req, res) => {
      if (req.body.role === 'ADMIN' && !atLeast(req.user.role, 'OWNER')) throw Forbidden('Only OWNER can invite ADMINs');
      const token = crypto.randomBytes(32).toString('hex');
      await withTransaction(mongoose, async (session) => {
        await Invite.create([{ organizationId: req.user.orgId, email: req.body.email, role: req.body.role, tokenHash: hash(token), invitedBy: req.user.id, expiresAt: new Date(Date.now() + cfg.inviteTtlHours * 3600 * 1000) }], { session });
        await outbox.enqueue(createEvent({ eventType: 'MEMBER_INVITED', organizationId: req.user.orgId, actorId: req.user.id, correlationId: req.correlationId, payload: { email: req.body.email.toLowerCase(), role: req.body.role, inviteToken: token } }), { session });
      });
      res.status(201).json({ inviteToken: token, expiresInHours: cfg.inviteTtlHours });
    }));

  r.post('/invites/accept', requireUser, validate(z.object({ token: z.string().min(10) })),
    asyncHandler(async (req, res) => {
      const invite = await Invite.findOne({ tokenHash: hash(req.body.token), acceptedAt: null, expiresAt: { $gt: new Date() } });
      if (!invite) throw NotFound('Invite invalid or expired');
      const user = await User.findById(req.user.id);
      if (user.email !== invite.email) throw Forbidden('This invite was issued to a different email');
      if (await Membership.exists({ organizationId: invite.organizationId, userId: user._id })) throw Conflict('Already a member');
      await withTransaction(mongoose, async (session) => {
        await Membership.create([{ organizationId: invite.organizationId, userId: user._id, role: invite.role }], { session });
        await Invite.updateOne({ _id: invite._id }, { acceptedAt: new Date() }, { session });
        await outbox.enqueue(createEvent({ eventType: 'MEMBER_JOINED', organizationId: String(invite.organizationId), actorId: String(user._id), correlationId: req.correlationId, payload: { userId: String(user._id), role: invite.role, email: user.email, name: user.name } }), { session });
      });
      res.status(201).json({ organizationId: invite.organizationId, role: invite.role });
    }));

  const ownerCount = (orgId) => Membership.countDocuments({ organizationId: orgId, role: 'OWNER' });

  r.patch('/members/:userId/role', requireOrgRole('ADMIN'),
    validate(z.object({ userId: objectId }), 'params'), validate(z.object({ role: z.enum(ROLES) })),
    asyncHandler(async (req, res) => {
      const target = await Membership.findOne({ organizationId: req.user.orgId, userId: req.params.userId });
      if (!target) throw NotFound('Member not found');
      if (req.user.role !== 'OWNER' && (target.role === 'OWNER' || req.body.role === 'OWNER' || req.body.role === 'ADMIN')) throw Forbidden('Only OWNER can change OWNER/ADMIN roles');
      if (target.role === 'OWNER' && req.body.role !== 'OWNER' && (await ownerCount(req.user.orgId)) <= 1) throw BadRequest('The last OWNER cannot be demoted');
      target.role = req.body.role;
      await target.save();
      res.json({ userId: target.userId, role: target.role });
    }));

  r.delete('/members/:userId', requireOrgRole('ADMIN'),
    validate(z.object({ userId: objectId }), 'params'),
    asyncHandler(async (req, res) => {
      const target = await Membership.findOne({ organizationId: req.user.orgId, userId: req.params.userId });
      if (!target) throw NotFound('Member not found');
      if (target.role === 'OWNER') {
        if (req.user.role !== 'OWNER') throw Forbidden('Only OWNER can remove an OWNER');
        if ((await ownerCount(req.user.orgId)) <= 1) throw BadRequest('The last OWNER cannot be removed');
      }
      await target.deleteOne();
      res.status(204).end();
    }));

  return r;
};
