#!/usr/bin/env node
// Usage: node replay-dlq.js <topic e.g. task.events.dlq> [brokers]
// Re-publishes each DLQ message to <topic>.retry targeted at the group that failed it.
const { Kafka, logLevel } = require('kafkajs');
const [dlq, brokers = process.env.KAFKA_BROKERS || 'localhost:9092'] = process.argv.slice(2);
if (!dlq || !dlq.endsWith('.dlq')) { console.error('usage: replay-dlq <topic>.dlq [brokers]'); process.exit(1); }

(async () => {
  const kafka = new Kafka({ clientId: 'dlq-replay', brokers: brokers.split(','), logLevel: logLevel.ERROR });
  const consumer = kafka.consumer({ groupId: `dlq-replay-${Date.now()}` });
  const producer = kafka.producer();
  await Promise.all([consumer.connect(), producer.connect()]);
  await consumer.subscribe({ topic: dlq, fromBeginning: true });
  let replayed = 0; let idle;
  const finish = async () => { console.log(`replayed ${replayed} message(s)`); await consumer.disconnect(); await producer.disconnect(); process.exit(0); };
  const arm = () => { clearTimeout(idle); idle = setTimeout(finish, 4000); };
  arm();
  await consumer.run({
    eachMessage: async ({ message }) => {
      const h = Object.fromEntries(Object.entries(message.headers || {}).map(([k, v]) => [k, String(v)]));
      const original = h['original-topic'] || dlq.replace(/\.dlq$/, '');
      await producer.send({ topic: `${original}.retry`, messages: [{ key: message.key, value: message.value, headers: { ...h, attempts: '0', 'retry-at': '0', 'original-topic': original } }] });
      replayed++; arm();
    },
  });
})().catch((e) => { console.error(e); process.exit(1); });
