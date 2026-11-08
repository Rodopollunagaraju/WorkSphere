const { createMetrics } = require('../src');
test('exposes custom metrics in Prometheus format', async () => {
  const m = createMetrics('svc');
  m.kafkaLag.set({ group: 'g', topic: 't', partition: '0' }, 7);
  m.cacheHooks('project').onHit();
  const out = await m.registry.metrics();
  expect(out).toContain('kafka_consumer_lag{group="g",topic="t",partition="0",service="svc"} 7');
  expect(out).toContain('cache_requests_total');
});
