const client = require('prom-client');

function createMetrics(service) {
  const registry = new client.Registry();
  registry.setDefaultLabels({ service });
  client.collectDefaultMetrics({ register: registry });
  const reg = { registers: [registry] };
  const m = {
    registry,
    httpDuration: new client.Histogram({ name: 'http_request_duration_seconds', help: 'HTTP latency', labelNames: ['method', 'route', 'status'], buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5], ...reg }),
    kafkaLag: new client.Gauge({ name: 'kafka_consumer_lag', help: 'Messages behind per partition', labelNames: ['group', 'topic', 'partition'], ...reg }),
    kafkaProcessed: new client.Counter({ name: 'kafka_messages_total', help: 'Messages by result', labelNames: ['group', 'topic', 'result'], ...reg }),
    outboxBacklog: new client.Gauge({ name: 'outbox_pending', help: 'Outbox rows waiting to be published', ...reg }),
    cache: new client.Counter({ name: 'cache_requests_total', help: 'Cache hits/misses', labelNames: ['cache', 'result'], ...reg }),
    rateLimited: new client.Counter({ name: 'rate_limit_rejections_total', help: '429 responses', labelNames: ['plan'], ...reg }),
  };
  m.middleware = (req, res, next) => {
    const end = m.httpDuration.startTimer();
    res.on('finish', () => end({ method: req.method, route: req.route ? (req.baseUrl || '') + req.route.path : (req.baseUrl || 'unmatched'), status: res.statusCode }));
    next();
  };
  m.handler = async (req, res) => { res.set('Content-Type', registry.contentType); res.end(await registry.metrics()); };
  m.mount = (app) => { app.use(m.middleware); app.get('/metrics', m.handler); };
  m.cacheHooks = (name) => ({ onHit: () => m.cache.inc({ cache: name, result: 'hit' }), onMiss: () => m.cache.inc({ cache: name, result: 'miss' }) });
  return m;
}
module.exports = { createMetrics };
