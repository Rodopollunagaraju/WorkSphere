const { topicFor, keyFor } = require('@worksphere/event-contracts');
let otel; try { otel = require('@opentelemetry/api'); } catch { /* tracing optional */ }

async function withTransaction(mongoose, fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await fn(session); });
    return result;
  } finally { session.endSession(); }
}

function createOutbox(mongoose) {
  const { Schema } = mongoose;
  const Outbox = mongoose.models.Outbox || mongoose.model('Outbox', new Schema({
    eventId: { type: String, required: true, unique: true },
    topic: String, key: String, event: Schema.Types.Mixed, headers: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ['PENDING', 'SENDING', 'SENT', 'FAILED'], default: 'PENDING' },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: () => new Date() },
    lockedAt: Date, sentAt: Date, lastError: String,
  }, { timestamps: true }).index({ status: 1, nextAttemptAt: 1, createdAt: 1 }).index({ sentAt: 1 }, { expireAfterSeconds: 7 * 86400 }));

  // MUST be called with the same session as the business write (single atomic transaction).
  async function enqueue(event, { session } = {}) {
    const headers = {};
    if (otel) otel.propagation.inject(otel.context.active(), headers); // keep trace across the async hop
    await Outbox.create([{ eventId: event.eventId, topic: topicFor(event.eventType), key: keyFor(event), event, headers }], { session });
  }
  const backlog = () => Outbox.countDocuments({ status: 'PENDING' });
  return { Outbox, enqueue, backlog };
}

const backoff = (attempts) => Math.min(30000, 250 * 2 ** attempts);

// Polls PENDING rows, claims them atomically (safe with several relay instances), publishes in order.
function createRelay({ Outbox, producer, logger = console, batchSize = 50, pollMs = 500, lockTimeoutMs = 30000, maxAttempts = 12 }) {
  let timer; let running = false; let stopped = false;

  async function tick() {
    await Outbox.updateMany({ status: 'SENDING', lockedAt: { $lt: new Date(Date.now() - lockTimeoutMs) } }, { $set: { status: 'PENDING' } });
    let sent = 0;
    for (let i = 0; i < batchSize; i++) {
      const doc = await Outbox.findOneAndUpdate(
        { status: 'PENDING', nextAttemptAt: { $lte: new Date() } },
        { $set: { status: 'SENDING', lockedAt: new Date() } },
        { sort: { createdAt: 1 }, new: true },
      ).lean();
      if (!doc) break;
      try {
        const publish = () => producer.send(doc.topic, doc.key, doc.event, doc.headers || {});
        if (otel) await otel.context.with(otel.propagation.extract(otel.ROOT_CONTEXT, doc.headers || {}), publish); else await publish();
        await Outbox.updateOne({ _id: doc._id }, { $set: { status: 'SENT', sentAt: new Date() } });
        sent++;
      } catch (err) {
        const attempts = doc.attempts + 1;
        logger.warn({ err: err.message, eventId: doc.eventId, attempts }, 'outbox publish failed');
        await Outbox.updateOne({ _id: doc._id }, { $set: { status: attempts >= maxAttempts ? 'FAILED' : 'PENDING', attempts, lastError: String(err.message).slice(0, 300), nextAttemptAt: new Date(Date.now() + backoff(attempts)) } });
        break; // stop the batch so later events do not overtake this one
      }
    }
    return sent;
  }

  const loop = async () => {
    if (stopped) return;
    if (!running) { running = true; try { await tick(); } catch (e) { logger.error({ err: e.message }, 'relay tick failed'); } running = false; }
    timer = setTimeout(loop, pollMs);
  };
  return { tick, start: () => { stopped = false; loop(); }, stop: () => { stopped = true; clearTimeout(timer); } };
}

module.exports = { createOutbox, createRelay, withTransaction, backoff };
