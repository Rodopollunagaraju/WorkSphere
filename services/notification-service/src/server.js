if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) throw new Error('JWT_SECRET must be set in production');
const http = require('node:http');
const mongoose = require('mongoose');
const { logger } = require('@worksphere/logger');
const { createRedis } = require('@worksphere/redis');
const { createProducer, createConsumer, createMongoIdempotency, startLagMonitor } = require('@worksphere/kafka');
const { createMetrics } = require('@worksphere/metrics');
const { TenantRepository } = require('@worksphere/tenant-repo');
const { TOPICS } = require('@worksphere/event-contracts');
const models = require('./models');
const { createApp } = require('./app');
const { createHandlers } = require('./handlers');
const { createDeliver } = require('./deliver');
const { createMailer, inviteEmailSender } = require('./mailer');
const { createSocketServer } = require('./socket');
const { startScheduler } = require('./scheduler');

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/worksphere_notifications?replicaSet=rs0');
  const redis = createRedis(process.env.REDIS_URL);
  const idem = createMongoIdempotency(mongoose, { logger });
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const metrics = createMetrics('notification-service');
  const mailer = createMailer({ host: process.env.SMTP_HOST, port: process.env.SMTP_PORT });

  const repos = { notifications: new TenantRepository(models.Notification), preferences: new TenantRepository(models.Preference) };
  const app = createApp({ repos, redis, metrics });
  const server = http.createServer(app);
  const { emitToUser } = createSocketServer(server, { pub: redis.duplicate(), sub: redis.duplicate(), jwtSecret: process.env.JWT_SECRET || 'dev-secret', redis });

  const deliver = createDeliver({ redis, emitToUser, mailer, models, logger });
  const handlers = createHandlers({ models, deliver, sendInviteEmail: inviteEmailSender(mailer, process.env.APP_URL || 'http://localhost:5173') });

  const brokers = process.env.KAFKA_BROKERS;
  const producer = createProducer({ brokers, clientId: 'notification-service' });
  await producer.connect();
  const groupId = 'notification-group'; const topics = [TOPICS.TASK, TOPICS.PROJECT, TOPICS.USER];
  const consumer = createConsumer({ brokers, clientId: 'notification-service', groupId, topics, handlers, runOnce: idem.runOnce, producer, logger, onResult: ({ topic, result }) => metrics.kafkaProcessed.inc({ group: groupId, topic, result }) });
  await consumer.start();
  const lag = startLagMonitor({ brokers, clientId: 'notification-service', groupId, topics, onLag: (l) => metrics.kafkaLag.set({ group: l.groupId, topic: l.topic, partition: l.partition }, l.lag) });
  const scheduler = startScheduler({ redis, models, deliver, logger });

  const port = Number(process.env.PORT || 4004);
  server.listen(port, () => logger.info({ port }, 'notification-service listening'));
  const shutdown = async () => { scheduler.stop(); lag.stop(); server.close(); await consumer.stop(); await producer.disconnect(); await mongoose.disconnect(); redis.disconnect(); process.exit(0); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}
main().catch((err) => { logger.error({ err }, 'startup failed'); process.exit(1); });
