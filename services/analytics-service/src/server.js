const mongoose = require('mongoose');
const { logger } = require('@worksphere/logger');
const { createProducer, createConsumer, createMongoIdempotency, startLagMonitor } = require('@worksphere/kafka');
const { createMetrics } = require('@worksphere/metrics');
const { TenantRepository } = require('@worksphere/tenant-repo');
const { TOPICS, payloads } = require('@worksphere/event-contracts');
const models = require('./models');
const { createApp } = require('./app');
const { createAnalyticsHandlers, createActivityHandlers } = require('./handlers');

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/worksphere_analytics?replicaSet=rs0');
  const idem = createMongoIdempotency(mongoose, { logger });
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const metrics = createMetrics('analytics-service');
  const brokers = process.env.KAFKA_BROKERS;
  const producer = createProducer({ brokers, clientId: 'analytics-service' });
  await producer.connect();

  const topics = [TOPICS.TASK, TOPICS.PROJECT, TOPICS.USER];
  // Two independent consumer groups on the same topics: each has its own offsets and failure domain.
  const groups = [
    { groupId: 'analytics-group', handlers: createAnalyticsHandlers({ models }) },
    { groupId: 'activity-group', handlers: createActivityHandlers({ models, eventTypes: Object.keys(payloads) }) },
  ];
  const running = []; const lags = [];
  for (const { groupId, handlers } of groups) {
    const c = createConsumer({ brokers, clientId: `analytics-${groupId}`, groupId, topics, handlers, runOnce: idem.runOnce, producer, logger, onResult: ({ topic, result }) => metrics.kafkaProcessed.inc({ group: groupId, topic, result }) });
    await c.start(); running.push(c);
    lags.push(startLagMonitor({ brokers, clientId: 'analytics-service', groupId, topics, onLag: (l) => metrics.kafkaLag.set({ group: l.groupId, topic: l.topic, partition: l.partition }, l.lag) }));
  }

  const app = createApp({ repos: { tasks: new TenantRepository(models.TaskSnapshot), projects: new TenantRepository(models.ProjectSnapshot), activity: new TenantRepository(models.ActivityLog) }, metrics });
  const port = Number(process.env.PORT || 4005);
  const server = app.listen(port, () => logger.info({ port }, 'analytics-service listening'));
  const shutdown = async () => { lags.forEach((l) => l.stop()); server.close(); await Promise.all(running.map((c) => c.stop())); await producer.disconnect(); await mongoose.disconnect(); process.exit(0); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}
main().catch((err) => { logger.error({ err }, 'startup failed'); process.exit(1); });
