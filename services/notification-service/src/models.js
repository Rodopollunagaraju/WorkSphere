const mongoose = require('mongoose');
const { Schema } = mongoose;
const opts = { timestamps: true, versionKey: false };

const notificationSchema = new Schema({
  organizationId: { type: String, required: true }, userId: { type: String, required: true },
  type: { type: String, required: true }, message: { type: String, required: true },
  data: { type: Schema.Types.Mixed, default: {} }, isRead: { type: Boolean, default: false },
}, opts);
notificationSchema.index({ organizationId: 1, userId: 1, isRead: 1, createdAt: -1 });

const directorySchema = new Schema({ organizationId: String, userId: String, email: String, name: String }, opts);
directorySchema.index({ organizationId: 1, userId: 1 }, { unique: true });

const prefSchema = new Schema({ organizationId: String, userId: String, email: { type: Boolean, default: true } }, opts);
prefSchema.index({ organizationId: 1, userId: 1 }, { unique: true });

// Local read model of task due dates, built from task events (no calls to the Task service).
const deadlineSchema = new Schema({
  organizationId: { type: String, required: true }, taskId: { type: String, required: true }, projectId: String,
  title: String, status: String, assignedTo: String, priority: String, dueDate: Date, createdBy: String,
  version: Number, deleted: { type: Boolean, default: false }, lastEventAt: Date,
  reminded24h: { type: Boolean, default: false }, remindedOverdue: { type: Boolean, default: false },
}, opts);
deadlineSchema.index({ organizationId: 1, taskId: 1 }, { unique: true });
deadlineSchema.index({ deleted: 1, status: 1, dueDate: 1 });

module.exports = {
  Notification: mongoose.model('Notification', notificationSchema), UserDirectory: mongoose.model('UserDirectory', directorySchema),
  Preference: mongoose.model('Preference', prefSchema), TaskDeadline: mongoose.model('TaskDeadline', deadlineSchema),
};
