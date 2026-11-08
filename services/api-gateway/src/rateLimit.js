const { createRateLimiter, limitForOrg, PLAN_LIMITS } = require('@worksphere/redis');
const { logger } = require('@worksphere/logger');

const PUBLIC_LIMIT = 30; // per IP per minute for login/register/refresh (brute-force guard)

// Plan-aware limiter: FREE 100/min, PRO 500/min, ENTERPRISE configurable (Redis org:limit).
// Key = org + user. One atomic Lua call per request. Fails OPEN if Redis is unavailable.
function rateLimit({ redis, metrics, windowMs = 60000 }) {
  const limiter = createRateLimiter(redis);
  return async (req, res, next) => {
    try {
      const user = req.headers['x-user-id']; const org = req.headers['x-org-id'];
      let key; let plan; let limit;
      if (user) {
        key = `rl:${org || 'none'}:${user}`;
        ({ plan, limit } = org ? await limitForOrg(redis, org, req.headers['x-plan']) : { plan: 'FREE', limit: PLAN_LIMITS.FREE });
      } else { key = `rl:ip:${req.ip}`; plan = 'PUBLIC'; limit = PUBLIC_LIMIT; }

      const r = await limiter.check({ key, limit, windowMs });
      res.set({ 'X-RateLimit-Limit': String(limit), 'X-RateLimit-Remaining': String(r.remaining), 'X-RateLimit-Plan': plan });
      if (!r.allowed) {
        const retry = Math.max(1, Math.ceil(r.retryAfterMs / 1000));
        res.set('Retry-After', String(retry));
        if (metrics) metrics.rateLimited.inc({ plan });
        return res.status(429).json({ error: { code: 'RATE_LIMITED', message: `Rate limit of ${limit}/min exceeded for plan ${plan}`, retryAfterSeconds: retry } });
      }
      next();
    } catch (err) {
      logger.warn({ err: err.message }, 'rate limiter unavailable, failing open');
      next();
    }
  };
}
module.exports = { rateLimit, PUBLIC_LIMIT };
