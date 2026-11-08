const http = require('node:http');
const { createInternalClient, withRetry } = require('../src');

let server; let base; let hits = 0;
beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits++;
    res.setHeader('content-type', 'application/json');
    if (req.url === '/ok') return res.end(JSON.stringify({ ok: true, token: req.headers['x-internal-token'] }));
    if (req.url === '/missing') { res.statusCode = 404; return res.end(JSON.stringify({ error: 'nope' })); }
    res.statusCode = 500; res.end('{}');
  });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => server.close());

test('sends the internal token and parses JSON', async () => {
  const c = createInternalClient({ baseUrl: base, token: 'tok' });
  expect(await c.get('/ok')).toEqual({ ok: true, token: 'tok' });
});
test('4xx is surfaced with status, not retried, and does not open the breaker', async () => {
  const c = createInternalClient({ baseUrl: base, token: 't', breakerOptions: { volumeThreshold: 1 } });
  hits = 0;
  for (let i = 0; i < 4; i++) await expect(c.get('/missing')).rejects.toMatchObject({ status: 404 });
  expect(hits).toBe(4);
  expect(c.breaker.opened).toBe(false);
});
test('withRetry retries 5xx then gives up', async () => {
  let n = 0;
  await expect(withRetry(async () => { n++; const e = new Error('x'); e.status = 503; throw e; }, { retries: 2, baseMs: 1 })).rejects.toThrow();
  expect(n).toBe(3);
});
