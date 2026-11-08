const mongoose = require('mongoose');
const { logger } = require('@worksphere/logger');
const { createRedis } = require('@worksphere/redis');
const { createProducer, createConsumer, createMongoIdempotency, startLagMonitor } = require('@worksphere/kafka');
const { createOutbox, createRelay, withTransaction } = require('@worksphere/outbox');
const { createMetrics } = require('@worksphere/metrics');
const { createInternalClient } = require('@worksphere/resilience');
const { TenantRepository } = require('@worksphere/tenant-repo');
const { TOPICS } = require('@worksphere/event-contracts');
const models = require('./models');
const { createApp } = require('./app');
const { createStorage } = require('./storage');
const createHandlers = require('./handlers');

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/worksphere_tasks?replicaSet=rs0');
  const redis = createRedis(process.env.REDIS_URL);
  const outbox = createOutbox(mongoose);
  const idem = createMongoIdempotency(mongoose, { logger });
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const brokers = process.env.KAFKA_BROKERS;
  const producer = createProducer({ brokers, clientId: 'task-service' });
  await producer.connect();
  const metrics = createMetrics('task-service');
  const relay = createRelay({ Outbox: outbox.Outbox, producer, logger });
  relay.start();
  setInterval(() => outbox.backlog().then((n) => metrics.outboxBacklog.set(n)).catch(() => {}), 5000).unref();

  // Consumes project.events to invalidate cached membership lookups across instances.
  const groupId = 'task-cache-group';
  const consumer = createConsumer({ brokers, clientId: 'task-service', groupId, topics: [TOPICS.PROJECT], handlers: createHandlers({ redis }), runOnce: idem.runOnce, producer, logger, onResult: ({ topic, result }) => metrics.kafkaProcessed.inc({ group: groupId, topic, result }) });
  await consumer.start();
  const lag = startLagMonitor({ brokers, clientId: 'task-service', groupId, topics: [TOPICS.PROJECT], onLag: ({ lag: l, ...labels }) => metrics.kafkaLag.set({ group: labels.groupId, topic: labels.topic, partition: labels.partition }, l) });

  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  const app = createApp({
    repos: { tasks: new TenantRepository(models.Task), comments: new TenantRepository(models.Comment), history: new TenantRepository(models.TaskHistory), attachments: new TenantRepository(models.Attachment) },
    outbox, redis, metrics, tx: (fn) => withTransaction(mongoose, fn),
    projectClient: createInternalClient({ baseUrl: process.env.PROJECT_SERVICE_URL || 'http://localhost:4002', token: internalToken }),
    storage: createStorage({ endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000', publicEndpoint: process.env.S3_PUBLIC_ENDPOINT || 'http://localhost:9000', bucket: process.env.S3_BUCKET || 'worksphere-attachments', accessKeyId: process.env.S3_ACCESS_KEY || 'worksphere', secretAccessKey: process.env.S3_SECRET_KEY || 'worksphere-secret' }),
  });
  const port = Number(process.env.PORT || 4003);
  const server = app.listen(port, () => logger.info({ port }, 'task-service listening'));
  const shutdown = async () => { relay.stop(); lag.stop(); server.close(); await consumer.stop(); await producer.disconnect(); await mongoose.disconnect(); redis.disconnect(); process.exit(0); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}
main().catch((err) => { logger.error({ err }, 'startup failed'); process.exit(1); });
