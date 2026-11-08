const mongoose = require('mongoose');
const { Schema } = mongoose;
const { ROLES } = require('../rbac');

const User = mongoose.model('User', new Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
}, { timestamps: true }));

const Organization = mongoose.model('Organization', new Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true },
  plan: { type: String, enum: ['FREE', 'PRO', 'ENTERPRISE'], default: 'FREE' },
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  settings: { type: Object, default: {} },
}, { timestamps: true }));

const membershipSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ROLES, required: true },
}, { timestamps: true });
membershipSchema.index({ organizationId: 1, userId: 1 }, { unique: true });
membershipSchema.index({ userId: 1 });
const Membership = mongoose.model('Membership', membershipSchema);

const inviteSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, required: true },
  email: { type: String, required: true, lowercase: true },
  role: { type: String, enum: ROLES.filter((r) => r !== 'OWNER'), required: true },
  tokenHash: { type: String, required: true, unique: true },
  invitedBy: { type: Schema.Types.ObjectId, required: true },
  expiresAt: { type: Date, required: true },
  acceptedAt: Date,
}, { timestamps: true });
inviteSchema.index({ organizationId: 1, email: 1 });
inviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });
const Invite = mongoose.model('Invite', inviteSchema);

module.exports = { User, Organization, Membership, Invite };
