const mongoose = require('mongoose');
const { logger } = require('@worksphere/logger');
const { createRedis } = require('@worksphere/redis');
const { createProducer } = require('@worksphere/kafka');
const { createOutbox, createRelay, withTransaction } = require('@worksphere/outbox');
const { createMetrics } = require('@worksphere/metrics');
const { createInternalClient } = require('@worksphere/resilience');
const { TenantRepository } = require('@worksphere/tenant-repo');
const { Project } = require('./models');
const { createApp } = require('./app');

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/worksphere_projects?replicaSet=rs0');
  const redis = createRedis(process.env.REDIS_URL);
  const outbox = createOutbox(mongoose);
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const producer = createProducer({ brokers: process.env.KAFKA_BROKERS, clientId: 'project-service' });
  await producer.connect();
  const metrics = createMetrics('project-service');
  const relay = createRelay({ Outbox: outbox.Outbox, producer, logger });
  relay.start();
  setInterval(() => outbox.backlog().then((n) => metrics.outboxBacklog.set(n)).catch(() => {}), 5000).unref();

  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  const app = createApp({
    repo: new TenantRepository(Project), outbox, redis, metrics, internalToken,
    authClient: createInternalClient({ baseUrl: process.env.AUTH_SERVICE_URL || 'http://localhost:4001', token: internalToken }),
    tx: (fn) => withTransaction(mongoose, fn),
  });
  const port = Number(process.env.PORT || 4002);
  const server = app.listen(port, () => logger.info({ port }, 'project-service listening'));
  const shutdown = async () => { relay.stop(); server.close(); await producer.disconnect(); await mongoose.disconnect(); redis.disconnect(); process.exit(0); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}
main().catch((err) => { logger.error({ err }, 'startup failed'); process.exit(1); });
