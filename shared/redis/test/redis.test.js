const RedisMock = require('ioredis-mock');
const { cacheAside, createRateLimiter, limitForOrg, keys, presence, withLock, deleteByPattern, hashOf } = require('../src');

const fresh = () => { const r = new RedisMock(); return r.flushall().then(() => r); };

test('cache-aside loads once, then serves from cache; keys carry the org', async () => {
  const r = await fresh(); const loader = jest.fn(async () => ({ id: 1 }));
  const k = keys.project('orgA', 'p1');
  expect(k).toContain('orgA');
  await cacheAside(r, k, 60, loader); await cacheAside(r, k, 60, loader);
  expect(loader).toHaveBeenCalledTimes(1);
  expect(await r.get(keys.project('orgB', 'p1'))).toBeNull(); // other tenant never sees it
});
test('stampede guard: concurrent cold reads trigger a single load', async () => {
  const r = await fresh(); let loads = 0;
  const loader = async () => { loads++; await new Promise((x) => setTimeout(x, 100)); return { v: 1 }; };
  await Promise.all(Array.from({ length: 5 }, () => cacheAside(r, 'k', 60, loader)));
  expect(loads).toBe(1);
});
test('null results are not cached', async () => {
  const r = await fresh(); const loader = jest.fn(async () => null);
  await cacheAside(r, 'nk', 60, loader); await cacheAside(r, 'nk', 60, loader);
  expect(loader).toHaveBeenCalledTimes(2);
});
test('sliding window Lua limiter never allows more than the limit, even concurrently', async () => {
  const r = await fresh(); const rl = createRateLimiter(r);
  const results = await Promise.all(Array.from({ length: 150 }, () => rl.check({ key: 'rl:o:u', limit: 100 })));
  expect(results.filter((x) => x.allowed)).toHaveLength(100);
  const denied = results.find((x) => !x.allowed);
  expect(denied.retryAfterMs).toBeGreaterThan(0);
});
test('limits follow the plan; enterprise limit is configurable; Redis plan beats stale token', async () => {
  const r = await fresh();
  expect((await limitForOrg(r, 'o1', 'FREE')).limit).toBe(100);
  expect((await limitForOrg(r, 'o1', 'PRO')).limit).toBe(500);
  await r.set(keys.orgPlan('o1'), 'ENTERPRISE'); await r.set(keys.orgLimit('o1'), '12345');
  expect(await limitForOrg(r, 'o1', 'FREE')).toEqual({ plan: 'ENTERPRISE', limit: 12345 });
});
test('presence tracks online users per org', async () => {
  const r = await fresh();
  await presence.heartbeat(r, 'o1', 'u1'); await presence.heartbeat(r, 'o2', 'u2');
  expect(await presence.online(r, 'o1')).toEqual(['u1']);
  await presence.remove(r, 'o1', 'u1');
  expect(await presence.online(r, 'o1')).toEqual([]);
});
test('lock: second holder is refused until released', async () => {
  const r = await fresh(); let inner;
  const outer = await withLock(r, 'job', 5000, async () => { inner = await withLock(r, 'job', 5000, async () => 1); return 'a'; });
  expect(outer).toEqual({ ran: true, result: 'a' });
  expect(inner).toEqual({ ran: false });
  expect((await withLock(r, 'job', 5000, async () => 'b')).ran).toBe(true);
});
test('deleteByPattern removes only matching keys; hashOf is order independent', async () => {
  const r = await fresh();
  await r.set('pm:o:p:u1', '1'); await r.set('pm:o:p:u2', '1'); await r.set('pm:o:q:u1', '1');
  expect(await deleteByPattern(r, 'pm:o:p:*')).toBe(2);
  expect(await r.get('pm:o:q:u1')).toBe('1');
  expect(hashOf({ a: 1, b: 2 })).toBe(hashOf({ b: 2, a: 1 }));
});

test('CACHE_DISABLED=1 bypasses the cache (used for cached-vs-uncached load tests)', async () => {
  const r = await fresh(); const loader = jest.fn(async () => ({ v: 1 }));
  process.env.CACHE_DISABLED = '1';
  try { await cacheAside(r, 'k', 60, loader); await cacheAside(r, 'k', 60, loader); } finally { delete process.env.CACHE_DISABLED; }
  expect(loader).toHaveBeenCalledTimes(2);
  expect(await r.get('k')).toBeNull();
});
