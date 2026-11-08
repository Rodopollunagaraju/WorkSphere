const mongoose = require('mongoose');
const { Schema } = mongoose;
const { STATUSES } = require('./workflow');
const opts = { timestamps: true, versionKey: false };

const taskSchema = new Schema({
  organizationId: { type: String, required: true },
  projectId: { type: String, required: true },
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  assignedTo: { type: String, default: null },
  priority: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'], default: 'MEDIUM' },
  status: { type: String, enum: STATUSES, default: 'TODO' },
  dueDate: { type: Date, default: null },
  createdBy: { type: String, required: true },
  labels: { type: [String], default: [] },
  version: { type: Number, default: 1 }, // optimistic concurrency
}, opts);
taskSchema.index({ organizationId: 1, projectId: 1, status: 1 });
taskSchema.index({ organizationId: 1, assignedTo: 1, status: 1 });
taskSchema.index({ organizationId: 1, dueDate: 1 });

const commentSchema = new Schema({
  organizationId: { type: String, required: true }, taskId: { type: String, required: true },
  authorId: { type: String, required: true }, body: { type: String, required: true }, mentions: { type: [String], default: [] },
}, opts);
commentSchema.index({ organizationId: 1, taskId: 1, createdAt: 1 });

const historySchema = new Schema({
  organizationId: { type: String, required: true }, taskId: { type: String, required: true },
  actorId: { type: String, required: true }, field: String, oldValue: Schema.Types.Mixed, newValue: Schema.Types.Mixed,
}, opts);
historySchema.index({ organizationId: 1, taskId: 1, createdAt: 1 });

const attachmentSchema = new Schema({
  organizationId: { type: String, required: true }, taskId: { type: String, required: true },
  key: { type: String, required: true }, fileName: String, size: Number, contentType: String,
  uploadedBy: String, confirmed: { type: Boolean, default: false },
}, opts);
attachmentSchema.index({ organizationId: 1, taskId: 1 });

module.exports = {
  Task: mongoose.model('Task', taskSchema), Comment: mongoose.model('Comment', commentSchema),
  TaskHistory: mongoose.model('TaskHistory', historySchema), Attachment: mongoose.model('Attachment', attachmentSchema),
};
