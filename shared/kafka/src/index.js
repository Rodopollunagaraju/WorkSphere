const { Kafka, logLevel } = require('kafkajs');
const { processMessage } = require('./processor');
const { createMongoIdempotency } = require('./idempotency');

const brokersFrom = (b) => (Array.isArray(b) ? b : String(b || 'localhost:9092').split(','));
const makeKafka = (clientId, brokers) => new Kafka({ clientId, brokers: brokersFrom(brokers), logLevel: logLevel.WARN, retry: { retries: 8, initialRetryTime: 300 } });

function createProducer({ brokers, clientId }) {
  const kafka = makeKafka(clientId, brokers);
  const producer = kafka.producer({ idempotent: true, maxInFlightRequests: 1 });
  return {
    kafka,
    connect: () => producer.connect(),
    disconnect: () => producer.disconnect(),
    send: (topic, key, value, headers = {}) => producer.send({
      topic, acks: -1,
      messages: [{ key: String(key), value: JSON.stringify(value), headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, String(v)])) }],
    }),
  };
}

// Registers handlers per eventType; consumes each topic plus its .retry sibling.
function createConsumer({ brokers, clientId, groupId, topics, handlers, runOnce, producer, maxAttempts = 4, baseDelayMs = 1000, logger = console, onResult = () => {} }) {
  const kafka = makeKafka(clientId, brokers);
  const consumer = kafka.consumer({ groupId, sessionTimeout: 30000 });
  const all = topics.flatMap((t) => [t, `${t}.retry`]);
  return {
    async start() {
      await consumer.connect();
      for (const t of all) await consumer.subscribe({ topic: t, fromBeginning: true });
      await consumer.run({
        eachMessage: async ({ topic, message }) => {
          const result = await processMessage({ topic, key: message.key, value: message.value, headers: message.headers },
            { groupId, handlers, runOnce, producer, maxAttempts, baseDelayMs, logger });
          onResult({ groupId, topic, result });
        },
      });
      logger.info({ groupId, topics: all }, 'consumer running');
    },
    stop: () => consumer.disconnect(),
  };
}

// Polls committed offsets vs log end offsets and reports lag per partition (feeds Prometheus).
function startLagMonitor({ brokers, clientId, groupId, topics, onLag, intervalMs = 5000, logger = console }) {
  const admin = makeKafka(`${clientId}-lag`, brokers).admin();
  let timer; let connected = false;
  const poll = async () => {
    try {
      if (!connected) { await admin.connect(); connected = true; }
      for (const topic of topics) {
        const end = await admin.fetchTopicOffsets(topic);
        const [committed] = await admin.fetchOffsets({ groupId, topics: [topic] });
        for (const p of committed.partitions) {
          const latest = Number((end.find((e) => e.partition === p.partition) || {}).offset || 0);
          const cur = Number(p.offset) < 0 ? 0 : Number(p.offset);
          onLag({ groupId, topic, partition: String(p.partition), lag: Math.max(0, latest - cur) });
        }
      }
    } catch (e) { logger.warn({ err: e.message }, 'lag poll failed'); }
    timer = setTimeout(poll, intervalMs);
  };
  poll();
  return { stop: () => { clearTimeout(timer); admin.disconnect().catch(() => {}); } };
}

module.exports = { createProducer, createConsumer, createMongoIdempotency, startLagMonitor, processMessage };
