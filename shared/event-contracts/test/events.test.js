const { createEvent, validateEvent, topicFor, keyFor } = require('../src');
const base = { organizationId: 'org1', actorId: 'u1', correlationId: 'c1' };
const snapshot = { title: 'T', status: 'TODO', assignedTo: 'u2', version: 1 };

test('createEvent builds a valid envelope', () => {
  const e = createEvent({ ...base, eventType: 'TASK_ASSIGNED', payload: { taskId: 't1', projectId: 'p1', assignedTo: 'u2', snapshot } });
  expect(e.eventId).toBeDefined();
  expect(e.version).toBe(1);
});
test('rejects payload that does not match eventType', () => {
  expect(() => createEvent({ ...base, eventType: 'TASK_ASSIGNED', payload: { taskId: 't1' } })).toThrow();
});
test('rejects unknown event types', () => {
  expect(() => validateEvent({ ...base, eventId: '00000000-0000-4000-8000-000000000000', eventType: 'NOPE', version: 1, occurredAt: new Date().toISOString(), payload: {} })).toThrow();
});
test('topics and partition keys', () => {
  expect(topicFor('TASK_CREATED')).toBe('task.events');
  expect(topicFor('COMMENT_ADDED')).toBe('task.events');
  expect(topicFor('PROJECT_ARCHIVED')).toBe('project.events');
  expect(topicFor('MEMBER_JOINED')).toBe('user.events');
  const e = createEvent({ ...base, eventType: 'TASK_CREATED', payload: { taskId: 't9', projectId: 'p1', snapshot } });
  expect(keyFor(e)).toBe('t9');
});
