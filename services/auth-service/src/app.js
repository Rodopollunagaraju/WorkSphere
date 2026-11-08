const express = require('express');
const helmet = require('helmet');
const { correlationMiddleware, logger } = require('@worksphere/logger');
const { errorHandler, NotFound, asyncHandler } = require('@worksphere/errors');
const { requireInternal } = require('@worksphere/rbac');
const { mountDocs } = require('@worksphere/docs');
const authRoutes = require('./routes/auth');
const memberRoutes = require('./routes/members');
const { Membership } = require('./models');
const routes = require('./docs');

function createApp({ tokenStore, outbox, redis, metrics, internalToken }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(correlationMiddleware);
  if (metrics) metrics.mount(app);
  app.use(express.json({ limit: '100kb' }));
  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  mountDocs(app, { title: 'Auth Service', prefix: '/api/auth', routes });

  // Service-to-service lookup (not routed by the gateway): is this user in this org?
  app.get('/internal/orgs/:orgId/members/:userId', requireInternal(internalToken), asyncHandler(async (req, res) => {
    const ok = /^[a-f0-9]{24}$/.test(req.params.orgId) && /^[a-f0-9]{24}$/.test(req.params.userId);
    const m = ok ? await Membership.findOne({ organizationId: req.params.orgId, userId: req.params.userId }) : null;
    res.json({ isMember: Boolean(m), role: m ? m.role : null });
  }));

  app.use('/auth', authRoutes({ tokenStore, outbox, redis }), memberRoutes({ outbox }));
  app.use((req, res, next) => next(NotFound('Route not found')));
  app.use(errorHandler(logger));
  return app;
}
module.exports = { createApp };
