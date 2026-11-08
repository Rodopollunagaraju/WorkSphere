const mongoose = require('mongoose');
const { Schema } = mongoose;

const projectSchema = new Schema({
  organizationId: { type: String, required: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  status: { type: String, enum: ['ACTIVE', 'ARCHIVED'], default: 'ACTIVE' },
  deadline: Date,
  createdBy: { type: String, required: true },
  members: { type: [String], default: [] },
}, { timestamps: true });
projectSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
projectSchema.index({ organizationId: 1, members: 1 });

module.exports = { Project: mongoose.model('Project', projectSchema) };
