const mongoose = require('mongoose');
const { logger } = require('@worksphere/logger');
const { createRedis } = require('@worksphere/redis');
const { createProducer } = require('@worksphere/kafka');
const { createOutbox, createRelay } = require('@worksphere/outbox');
const { createMetrics } = require('@worksphere/metrics');
const cfg = require('./config');
const { createApp } = require('./app');
const { createTokenStore } = require('./tokens');
require('./models');

async function main() {
  await mongoose.connect(cfg.mongoUri);
  const redis = createRedis(cfg.redisUrl);
  const outbox = createOutbox(mongoose);
  await Promise.all(Object.values(mongoose.models).map((m) => m.init())); // build indexes
  const producer = createProducer({ brokers: process.env.KAFKA_BROKERS, clientId: 'auth-service' });
  await producer.connect();
  const metrics = createMetrics('auth-service');
  const relay = createRelay({ Outbox: outbox.Outbox, producer, logger });
  relay.start();
  setInterval(() => outbox.backlog().then((n) => metrics.outboxBacklog.set(n)).catch(() => {}), 5000).unref();

  const app = createApp({ tokenStore: createTokenStore(redis), outbox, redis, metrics, internalToken: process.env.INTERNAL_SERVICE_TOKEN });
  const server = app.listen(cfg.port, () => logger.info({ port: cfg.port }, 'auth-service listening'));
  const shutdown = async () => { relay.stop(); server.close(); await producer.disconnect(); await mongoose.disconnect(); redis.disconnect(); process.exit(0); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}
main().catch((err) => { logger.error({ err }, 'startup failed'); process.exit(1); });
