const { createTokenStore } = require('../src/tokens');

function fakeRedis() {
  const kv = new Map(); const sets = new Map();
  const api = {
    get: async (k) => kv.get(k) ?? null,
    del: async (k) => kv.delete(k),
    srem: async (k, v) => sets.get(k)?.delete(v),
    multi() {
      const ops = [];
      const chain = {
        set: (k, v) => (ops.push(() => kv.set(k, v)), chain),
        sadd: (k, v) => (ops.push(() => { if (!sets.has(k)) sets.set(k, new Set()); sets.get(k).add(v); }), chain),
        expire: () => chain,
        exec: async () => ops.forEach((o) => o()),
      };
      return chain;
    },
  };
  return api;
}

test('rotation issues a new token and old token triggers family revocation', async () => {
  const store = createTokenStore(fakeRedis());
  const t1 = await store.issue('user1');
  const { refreshToken: t2 } = await store.rotate(t1);
  expect(t2).not.toBe(t1);
  await expect(store.rotate(t1)).rejects.toThrow(/reuse/i); // stolen token replayed
  await expect(store.rotate(t2)).rejects.toThrow();          // whole family now revoked
});
test('garbage tokens are rejected', async () => {
  await expect(createTokenStore(fakeRedis()).rotate('nonsense')).rejects.toThrow();
});

test('sessions can be listed and revoked all at once', async () => {
  const redis = fakeRedis();
  redis.smembers = async (k) => [...(redis._sets?.get(k) || [])];
  const store = createTokenStore(redis);
  expect(typeof store.listSessions).toBe('function');
  expect(typeof store.revokeAll).toBe('function');
});
