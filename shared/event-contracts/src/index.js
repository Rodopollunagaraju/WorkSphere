const crypto = require('node:crypto');
const { z } = require('zod');

const id = z.string().min(1);
// Full task state carried by every TASK_* event so read models can be rebuilt idempotently.
const snapshot = z.object({
  title: z.string(), status: z.string(), assignedTo: id.nullish(), priority: z.string().optional(),
  dueDate: z.string().nullish(), createdBy: id.optional(), version: z.number().int(),
});
const task = (extra = {}) => z.object({ taskId: id, projectId: id, snapshot, ...extra });

const payloads = {
  TASK_CREATED: task(),
  TASK_UPDATED: task({ changes: z.record(z.any()) }),
  TASK_ASSIGNED: task({ assignedTo: id, previousAssignee: id.nullish() }),
  TASK_STATUS_CHANGED: task({ from: z.string(), to: z.string() }),
  TASK_COMPLETED: task(),
  TASK_DELETED: task(),
  COMMENT_ADDED: z.object({ taskId: id, projectId: id, commentId: id, mentions: z.array(id).default([]), taskTitle: z.string().optional() }),
  PROJECT_CREATED: z.object({ projectId: id, name: z.string() }),
  PROJECT_UPDATED: z.object({ projectId: id, name: z.string().optional(), changes: z.record(z.any()) }),
  PROJECT_ARCHIVED: z.object({ projectId: id, name: z.string().optional() }),
  PROJECT_MEMBER_ADDED: z.object({ projectId: id, userId: id, projectName: z.string().optional() }),
  PROJECT_MEMBER_REMOVED: z.object({ projectId: id, userId: id }),
  MEMBER_INVITED: z.object({ email: z.string().email(), role: z.string(), inviteToken: z.string().optional() }),
  MEMBER_JOINED: z.object({ userId: id, role: z.string(), email: z.string().optional(), name: z.string().optional() }),
};

const TOPICS = { TASK: 'task.events', PROJECT: 'project.events', USER: 'user.events' };

const envelope = z.object({
  eventId: z.string().uuid(),
  eventType: z.enum(Object.keys(payloads)),
  version: z.number().int().positive(),
  organizationId: id,
  actorId: id,
  correlationId: z.string().optional(),
  occurredAt: z.string().datetime(),
  payload: z.record(z.any()),
});

function validateEvent(event) {
  const env = envelope.parse(event);
  env.payload = payloads[env.eventType].parse(env.payload);
  return env;
}

function createEvent({ eventType, organizationId, actorId, correlationId, payload, version = 1 }) {
  return validateEvent({
    eventId: crypto.randomUUID(), eventType, version, organizationId, actorId, correlationId,
    occurredAt: new Date().toISOString(), payload,
  });
}

const topicFor = (type) => (type.startsWith('TASK_') || type.startsWith('COMMENT_') ? TOPICS.TASK
  : type.startsWith('PROJECT_') ? TOPICS.PROJECT : TOPICS.USER);
// Partition key: keeps all events of one task (or project) ordered.
const keyFor = (e) => e.payload.taskId || e.payload.projectId || e.organizationId;

module.exports = { createEvent, validateEvent, payloads, envelope, TOPICS, topicFor, keyFor };
