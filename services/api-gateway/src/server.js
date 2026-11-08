if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) throw new Error('JWT_SECRET must be set in production');
process.env.SERVICE_NAME = process.env.SERVICE_NAME || 'api-gateway';
const http = require('node:http');
const { logger } = require('@worksphere/logger');
const { createRedis } = require('@worksphere/redis');
const { createMetrics } = require('@worksphere/metrics');
const { createApp } = require('./app');

const u = (name, def) => process.env[name] || def;
const app = createApp({
  jwtSecret: u('JWT_SECRET', 'dev-secret'),
  redis: createRedis(process.env.REDIS_URL),
  metrics: createMetrics('api-gateway'),
  corsOrigin: u('CORS_ORIGIN', '*'),
  services: {
    auth: u('AUTH_SERVICE_URL', 'http://localhost:4001'), project: u('PROJECT_SERVICE_URL', 'http://localhost:4002'),
    task: u('TASK_SERVICE_URL', 'http://localhost:4003'), notification: u('NOTIFICATION_SERVICE_URL', 'http://localhost:4004'),
    analytics: u('ANALYTICS_SERVICE_URL', 'http://localhost:4005'),
  },
});
const server = http.createServer(app);
server.on('upgrade', app.wsProxy.upgrade);
const port = Number(u('PORT', 3000));
server.listen(port, () => logger.info({ port }, 'api-gateway listening'));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
