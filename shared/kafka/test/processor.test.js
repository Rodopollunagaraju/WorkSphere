const { processMessage } = require('../src/processor');
const { createEvent } = require('@worksphere/event-contracts');

const snapshot = { title: 'T', status: 'TODO', assignedTo: 'u2', version: 1 };
const ev = () => createEvent({ eventType: 'TASK_ASSIGNED', organizationId: 'o', actorId: 'u1', payload: { taskId: 't', projectId: 'p', assignedTo: 'u2', snapshot } });
const msg = (e, topic = 'task.events', headers = {}) => ({ topic, key: 't', value: Buffer.from(JSON.stringify(e)), headers });

function setup(handler, extra = {}) {
  const seen = new Set(); const sent = [];
  const runOnce = async (g, id, fn) => { if (seen.has(g + id)) return 'duplicate'; await fn({}); seen.add(g + id); return 'processed'; };
  return { sent, deps: { groupId: 'g1', handlers: { TASK_ASSIGNED: handler }, runOnce, producer: { send: async (...a) => sent.push(a) }, sleep: async () => {}, logger: { warn() {} }, baseDelayMs: 10, maxAttempts: 3, ...extra } };
}

test('handler runs once even if the same event is delivered twice', async () => {
  const h = jest.fn(); const { deps } = setup(h); const e = ev();
  expect(await processMessage(msg(e), deps)).toBe('processed');
  expect(await processMessage(msg(e), deps)).toBe('duplicate');
  expect(h).toHaveBeenCalledTimes(1);
});
test('failure goes to the retry topic with attempts, target group and backoff', async () => {
  const { deps, sent } = setup(async () => { throw new Error('boom'); });
  expect(await processMessage(msg(ev()), deps)).toBe('retried');
  const [topic, , , headers] = sent[0];
  expect(topic).toBe('task.events.retry');
  expect(headers).toMatchObject({ attempts: '1', 'target-group': 'g1', 'original-topic': 'task.events' });
  expect(Number(headers['retry-at'])).toBeGreaterThan(Date.now() - 1000);
});
test('after maxAttempts the message lands in the DLQ with the reason', async () => {
  const { deps, sent } = setup(async () => { throw new Error('still broken'); });
  const r = await processMessage(msg(ev(), 'task.events.retry', { attempts: '2', 'original-topic': 'task.events', 'target-group': 'g1', 'retry-at': '0' }), deps);
  expect(r).toBe('dead');
  expect(sent[0][0]).toBe('task.events.dlq');
  expect(sent[0][3]['last-error']).toContain('still broken');
});
test('malformed events go straight to the DLQ without running handlers', async () => {
  const h = jest.fn(); const { deps, sent } = setup(h);
  expect(await processMessage({ topic: 'task.events', key: 'k', value: Buffer.from('{not json'), headers: {} }, deps)).toBe('dead');
  expect(await processMessage(msg({ eventType: 'TASK_ASSIGNED' }), deps)).toBe('dead');
  expect(h).not.toHaveBeenCalled();
  expect(sent.every((s) => s[0] === 'task.events.dlq')).toBe(true);
});
test('retry messages targeted at another group are skipped', async () => {
  const h = jest.fn(); const { deps } = setup(h);
  expect(await processMessage(msg(ev(), 'task.events.retry', { 'target-group': 'other', 'retry-at': '0' }), deps)).toBe('skipped');
  expect(h).not.toHaveBeenCalled();
});
test('retry messages wait until retry-at', async () => {
  const sleep = jest.fn(async () => {}); const { deps } = setup(jest.fn(), { sleep });
  await processMessage(msg(ev(), 'task.events.retry', { 'target-group': 'g1', 'retry-at': String(Date.now() + 5000) }), deps);
  expect(sleep).toHaveBeenCalled();
});
test('unknown event types are ignored, not failed', async () => {
  const { deps } = setup(jest.fn(), { handlers: {} });
  expect(await processMessage(msg(ev()), deps)).toBe('ignored');
});
