const mongoose = require('mongoose');
const { Schema } = mongoose;
const opts = { timestamps: true, versionKey: false };

// CQRS read models, built ONLY from Kafka events (this service never calls Task/Project).
const taskSnap = new Schema({
  organizationId: { type: String, required: true }, taskId: { type: String, required: true }, projectId: { type: String, required: true },
  title: String, status: String, assignedTo: String, priority: String, dueDate: Date, createdBy: String,
  version: Number, deleted: { type: Boolean, default: false }, lastEventAt: Date,
}, opts);
taskSnap.index({ organizationId: 1, taskId: 1 }, { unique: true });
taskSnap.index({ organizationId: 1, projectId: 1, deleted: 1, status: 1 });
taskSnap.index({ organizationId: 1, assignedTo: 1, deleted: 1, status: 1 });
taskSnap.index({ organizationId: 1, dueDate: 1 });

const projectSnap = new Schema({
  organizationId: { type: String, required: true }, projectId: { type: String, required: true },
  name: String, status: { type: String, default: 'ACTIVE' }, members: { type: [String], default: [] },
}, opts);
projectSnap.index({ organizationId: 1, projectId: 1 }, { unique: true });
projectSnap.index({ organizationId: 1, members: 1 });

const activity = new Schema({
  organizationId: { type: String, required: true }, eventId: { type: String, required: true },
  eventType: String, actorId: String, entityType: String, entityId: String, projectId: String,
  summary: String, occurredAt: Date,
}, opts);
activity.index({ organizationId: 1, eventId: 1 }, { unique: true });
activity.index({ organizationId: 1, occurredAt: -1 });

module.exports = {
  TaskSnapshot: mongoose.model('TaskSnapshot', taskSnap), ProjectSnapshot: mongoose.model('ProjectSnapshot', projectSnap),
  ActivityLog: mongoose.model('ActivityLog', activity),
};
