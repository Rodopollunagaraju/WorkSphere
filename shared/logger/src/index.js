const { AsyncLocalStorage } = require('node:async_hooks');
const crypto = require('node:crypto');
const pino = require('pino');

const als = new AsyncLocalStorage();

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { service: process.env.SERVICE_NAME || 'unknown' },
  mixin() {
    const ctx = als.getStore();
    return ctx ? { correlationId: ctx.correlationId } : {};
  },
});

const runWithContext = (ctx, fn) => als.run(ctx, fn);
const getContext = () => als.getStore() || {};

// Express middleware: propagate or create X-Correlation-Id for every request.
function correlationMiddleware(req, res, next) {
  const correlationId = req.headers['x-correlation-id'] || crypto.randomUUID();
  req.correlationId = correlationId;
  res.setHeader('x-correlation-id', correlationId);
  runWithContext({ correlationId }, next);
}

module.exports = { logger, runWithContext, getContext, correlationMiddleware };
