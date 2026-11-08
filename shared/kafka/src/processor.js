const { validateEvent } = require('@worksphere/event-contracts');

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const normalizeHeaders = (h = {}) => Object.fromEntries(Object.entries(h).map(([k, v]) => [k, v == null ? '' : v.toString()]));

// Pure message pipeline (no Kafka client): validate -> idempotent handler -> retry topic -> DLQ.
async function processMessage(msg, d) {
  const { groupId, handlers, runOnce, producer, maxAttempts = 4, baseDelayMs = 1000, sleep = defaultSleep, logger = console } = d;
  const headers = normalizeHeaders(msg.headers);
  const isRetry = msg.topic.endsWith('.retry');

  // Retry topics are shared by all groups; only the group that failed reprocesses.
  if (isRetry && headers['target-group'] && headers['target-group'] !== groupId) return 'skipped';
  const wait = Number(headers['retry-at'] || 0) - Date.now();
  if (isRetry && wait > 0) await sleep(Math.min(wait, 60000));

  const originalTopic = headers['original-topic'] || msg.topic.replace(/\.retry$/, '');
  const text = msg.value ? msg.value.toString() : '';
  const key = msg.key ? msg.key.toString() : 'unknown';

  let parsed; let event;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  try { event = validateEvent(parsed); } catch (err) {
    await producer.send(`${originalTopic}.dlq`, key, parsed, { 'original-topic': originalTopic, 'target-group': groupId, attempts: '0', 'last-error': `invalid-event: ${String(err.message).slice(0, 300)}` });
    return 'dead';
  }

  const handler = handlers[event.eventType];
  if (!handler) return 'ignored';

  try {
    return await runOnce(groupId, event.eventId, (session) => handler(event, { session, headers }));
  } catch (err) {
    const attempts = Number(headers.attempts || 0) + 1;
    const base = { 'original-topic': originalTopic, 'target-group': groupId, attempts: String(attempts), 'last-error': String(err.message).slice(0, 500), 'correlation-id': event.correlationId || '' };
    logger.warn({ err: err.message, eventId: event.eventId, attempts }, 'handler failed');
    if (attempts < maxAttempts) {
      await producer.send(`${originalTopic}.retry`, key, event, { ...base, 'retry-at': String(Date.now() + baseDelayMs * 2 ** (attempts - 1)) });
      return 'retried';
    }
    await producer.send(`${originalTopic}.dlq`, key, event, base);
    return 'dead';
  }
}

module.exports = { processMessage, normalizeHeaders };
