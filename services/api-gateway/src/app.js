const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { correlationMiddleware, logger } = require('@worksphere/logger');
const { errorHandler, Unauthorized, NotFound } = require('@worksphere/errors');
const { rateLimit } = require('./rateLimit');

const PUBLIC = [['POST', '/api/auth/register'], ['POST', '/api/auth/login'], ['POST', '/api/auth/refresh']];
// req.path is relative to the mount point inside app.use('/api'), so use baseUrl + path.
const isPublic = (req) => PUBLIC.some(([m, p]) => req.method === m && req.baseUrl + req.path === p);
// Any client-supplied identity header is removed before we set verified ones.
const IDENTITY_HEADERS = ['x-user-id', 'x-org-id', 'x-role', 'x-plan', 'x-internal-token'];

function authenticate({ jwtSecret }) {
  return (req, res, next) => {
    for (const h of IDENTITY_HEADERS) delete req.headers[h];
    if (isPublic(req)) return next();
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!m) return next(Unauthorized('Missing bearer token'));
    try {
      const c = jwt.verify(m[1], jwtSecret, { algorithms: ['HS256'] });
      req.headers['x-user-id'] = c.sub;
      if (c.orgId) { req.headers['x-org-id'] = c.orgId; req.headers['x-role'] = c.role; req.headers['x-plan'] = c.plan; }
      next();
    } catch { next(Unauthorized('Invalid or expired token')); }
  };
}

const ROUTES = [['auth', '/api/auth', '/auth'], ['project', '/api/projects', '/projects'], ['task', '/api/tasks', '/tasks'], ['notification', '/api/notifications', '/notifications'], ['analytics', '/api/analytics', '/analytics']];

function createApp({ jwtSecret, services, redis, metrics, corsOrigin = '*' }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: corsOrigin, exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'Retry-After', 'X-Correlation-Id'] }));
  app.use(correlationMiddleware);
  if (metrics) metrics.mount(app);
  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  // The body is NOT parsed here so it streams straight to the upstream service.
  // Express strips the mount path, so we prepend the upstream prefix back.
  const proxy = (target, upstreamPrefix, extra = {}) => createProxyMiddleware({
    target, changeOrigin: true, pathRewrite: (path) => upstreamPrefix + (/^\/(\?|$)/.test(path) && upstreamPrefix !== '/docs' ? path.slice(1) : path),
    on: {
      proxyReq: (proxyReq, req) => { if (req.correlationId) proxyReq.setHeader('x-correlation-id', req.correlationId); },
      error: (err, req, res) => { logger.error({ err: err.message }, 'upstream error'); if (res.writeHead && !res.headersSent) res.status(502).json({ error: { code: 'BAD_GATEWAY', message: 'Upstream unavailable' } }); },
    },
    ...extra,
  });

  // Swagger UIs of every service, reachable only through the gateway.
  const docLinks = ROUTES.filter(([k]) => services[k]).map(([k]) => k);
  app.get('/docs', (req, res) => res.type('html').send(`<!doctype html><title>WorkSphere API docs</title><body style="font-family:system-ui;max-width:640px;margin:48px auto"><h1>WorkSphere API docs</h1><ul>${docLinks.map((k) => `<li><a href="/docs/${k}/">${k} service</a></li>`).join('')}</ul></body>`));
  for (const k of docLinks) app.use(`/docs/${k}`, proxy(services[k], '/docs'));

  app.use('/api', authenticate({ jwtSecret }));
  if (redis) app.use('/api', rateLimit({ redis, metrics }));
  for (const [key, mount, upstream] of ROUTES) if (services[key]) app.use(mount, proxy(services[key], upstream));

  // WebSocket (Socket.IO) goes straight to the notification service; it authenticates the handshake itself.
  if (services.notification) {
    app.wsProxy = createProxyMiddleware({ target: services.notification, changeOrigin: true, ws: true, pathFilter: '/socket.io' });
    app.use(app.wsProxy);
  }

  app.use((req, res, next) => next(NotFound('Route not found')));
  app.use(errorHandler(logger));
  return app;
}
module.exports = { createApp, authenticate, isPublic, ROUTES };
