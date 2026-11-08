const Redis = require('ioredis');
const crypto = require('node:crypto');

const createRedis = (url, opts = {}) => new Redis(url || 'redis://localhost:6379', { maxRetriesPerRequest: 3, ...opts });

// Every key embeds the organization to prevent cross-tenant leakage.
const keys = {
  project: (org, id) => `project:${org}:${id}`,
  taskListVersion: (org, projectId) => `tasklist:ver:${org}:${projectId}`,
  taskList: (org, projectId, ver, filterHash) => `tasklist:${org}:${projectId}:v${ver}:${filterHash}`,
  membership: (org, projectId, userId) => `pm:${org}:${projectId}:${userId}`,
  unread: (org, userId) => `unread:${org}:${userId}`,
  presence: (org) => `presence:${org}`,
  orgPlan: (org) => `org:plan:${org}`,
  orgLimit: (org) => `org:limit:${org}`,
};
const hashOf = (obj) => crypto.createHash('sha1').update(JSON.stringify(obj, Object.keys(obj).sort())).digest('hex').slice(0, 12);

const jitter = (ttl) => Math.round(ttl * (0.9 + Math.random() * 0.2));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Cache-aside with TTL jitter and a short per-key lock so a cold key is loaded once (stampede guard).
async function cacheAside(redis, key, ttlSec, loader, { onHit = () => {}, onMiss = () => {}, lockMs = 5000, waitTries = 20 } = {}) {
  if (process.env.CACHE_DISABLED === '1') { onMiss(); return loader(); } // benchmark switch: bypass the cache entirely
  const hit = await redis.get(key);
  if (hit !== null) { onHit(); return JSON.parse(hit); }
  onMiss();
  const lockKey = `lock:${key}`;
  const got = await redis.set(lockKey, '1', 'PX', lockMs, 'NX');
  if (!got) {
    for (let i = 0; i < waitTries; i++) { // someone else is loading: wait for their result
      await sleep(50);
      const again = await redis.get(key);
      if (again !== null) return JSON.parse(again);
    }
  }
  try {
    const value = await loader();
    if (value !== null && value !== undefined) await redis.set(key, JSON.stringify(value), 'EX', jitter(ttlSec));
    return value;
  } finally { if (got) await redis.del(lockKey); }
}

async function deleteByPattern(redis, pattern) {
  let n = 0;
  const stream = redis.scanStream({ match: pattern, count: 200 });
  for await (const batch of stream) if (batch.length) { await redis.del(...batch); n += batch.length; }
  return n;
}
const bumpVersion = (redis, key) => redis.incr(key);
const getVersion = async (redis, key) => (await redis.get(key)) || '0';

// Sliding-window log in one atomic Lua script (no race between check and add).
const SLIDING_WINDOW_LUA = `
local key=KEYS[1]
local now=tonumber(ARGV[1])
local window=tonumber(ARGV[2])
local limit=tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE',key,0,now-window)
local count=redis.call('ZCARD',key)
if count < limit then
  redis.call('ZADD',key,now,ARGV[4])
  redis.call('PEXPIRE',key,window)
  return {1, limit-count-1, 0}
end
local oldest=redis.call('ZRANGE',key,0,0,'WITHSCORES')
return {0, 0, window-(now-tonumber(oldest[2]))}
`;
function createRateLimiter(redis) {
  return {
    async check({ key, limit, windowMs = 60000 }) {
      const now = Date.now();
      const [ok, remaining, retryMs] = await redis.eval(SLIDING_WINDOW_LUA, 1, key, now, windowMs, limit, `${now}-${crypto.randomBytes(6).toString('hex')}`);
      return { allowed: ok === 1, remaining: Number(remaining), retryAfterMs: Number(retryMs), limit };
    },
  };
}
const PLAN_LIMITS = { FREE: 100, PRO: 500, ENTERPRISE: 5000 };
async function limitForOrg(redis, orgId, tokenPlan) {
  const [plan, custom] = await redis.mget(keys.orgPlan(orgId), keys.orgLimit(orgId));
  const effective = plan || tokenPlan || 'FREE';
  if (effective === 'ENTERPRISE' && custom && Number(custom) > 0) return { plan: effective, limit: Number(custom) };
  return { plan: effective, limit: PLAN_LIMITS[effective] || PLAN_LIMITS.FREE };
}

// Presence: sorted set of userId -> last heartbeat; "online" = heartbeat within the TTL window.
const PRESENCE_TTL_MS = 60000;
const presence = {
  heartbeat: (redis, org, user) => redis.zadd(keys.presence(org), Date.now(), user),
  remove: (redis, org, user) => redis.zrem(keys.presence(org), user),
  async online(redis, org) {
    await redis.zremrangebyscore(keys.presence(org), 0, Date.now() - PRESENCE_TTL_MS);
    return redis.zrangebyscore(keys.presence(org), Date.now() - PRESENCE_TTL_MS, '+inf');
  },
};

// Distributed lock with token-checked release (only the owner can unlock).
const UNLOCK_LUA = `if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end`;
async function withLock(redis, name, ttlMs, fn) {
  const token = crypto.randomUUID();
  const ok = await redis.set(`lock:${name}`, token, 'PX', ttlMs, 'NX');
  if (!ok) return { ran: false };
  try { return { ran: true, result: await fn() }; } finally { await redis.eval(UNLOCK_LUA, 1, `lock:${name}`, token); }
}

module.exports = { createRedis, keys, hashOf, cacheAside, deleteByPattern, bumpVersion, getVersion, createRateLimiter, limitForOrg, PLAN_LIMITS, presence, withLock, SLIDING_WINDOW_LUA };
