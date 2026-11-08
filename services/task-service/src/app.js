const express = require('express');
const helmet = require('helmet');
const { correlationMiddleware, logger } = require('@worksphere/logger');
const { errorHandler, NotFound } = require('@worksphere/errors');
const { mountDocs } = require('@worksphere/docs');
const taskRoutes = require('./routes');
const docs = require('./docs');

function createApp(deps) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(correlationMiddleware);
  if (deps.metrics) deps.metrics.mount(app);
  app.use(express.json({ limit: '100kb' }));
  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  mountDocs(app, { title: 'Task Service', prefix: '/api', routes: docs });
  app.use(taskRoutes(deps));
  app.use((req, res, next) => next(NotFound('Route not found')));
  app.use(errorHandler(logger));
  return app;
}
module.exports = { createApp };
