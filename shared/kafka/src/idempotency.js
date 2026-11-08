// Exactly-once *effects* for MongoDB side effects: the dedupe record and the handler's writes
// commit in ONE transaction. Handlers may return a function that runs after commit
// (socket pushes, Redis counters, emails): best-effort, errors are logged.
class DuplicateSignal extends Error {}

function createMongoIdempotency(mongoose, { logger = console } = {}) {
  const { Schema } = mongoose;
  const Processed = mongoose.models.ProcessedEvent || mongoose.model('ProcessedEvent', new Schema({
    consumerGroup: { type: String, required: true }, eventId: { type: String, required: true },
    processedAt: { type: Date, default: Date.now },
  }).index({ consumerGroup: 1, eventId: 1 }, { unique: true }).index({ processedAt: 1 }, { expireAfterSeconds: 30 * 86400 }));

  async function runOnce(consumerGroup, eventId, fn) {
    if (await Processed.exists({ consumerGroup, eventId })) return 'duplicate'; // fast path
    const session = await mongoose.startSession();
    let after;
    try {
      await session.withTransaction(async () => {
        after = undefined;
        try { await Processed.create([{ consumerGroup, eventId }], { session }); } catch (e) { if (e.code === 11000) throw new DuplicateSignal(); throw e; }
        after = await fn(session);
      });
    } catch (e) {
      if (e instanceof DuplicateSignal) return 'duplicate';
      throw e;
    } finally { session.endSession(); }
    if (typeof after === 'function') { try { await after(); } catch (e) { logger.error({ err: e.message }, 'post-commit effect failed'); } }
    return 'processed';
  }
  return { runOnce, Processed };
}

module.exports = { createMongoIdempotency };
