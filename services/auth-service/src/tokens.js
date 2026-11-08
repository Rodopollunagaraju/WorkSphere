const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const cfg = require('./config');
const { Unauthorized } = require('@worksphere/errors');

// Access token: user-level (no org) or org-scoped (orgId, role, plan).
const signAccess = ({ userId, orgId = null, role = null, plan = null }) =>
  jwt.sign({ sub: userId, orgId, role, plan }, cfg.jwtSecret, { expiresIn: cfg.accessTtl });

// Opaque refresh token "familyId.tokenId". Redis keeps only the CURRENT tokenId per family.
// Presenting an older tokenId means the token was stolen/reused: revoke the whole family.
function createTokenStore(redis) {
  const famKey = (f) => `rt:${f}`;
  const userKey = (u) => `user_sessions:${u}`;

  async function issue(userId, familyId = crypto.randomUUID()) {
    const tokenId = crypto.randomBytes(24).toString('hex');
    await redis.multi()
      .set(famKey(familyId), JSON.stringify({ userId, tokenId }), 'EX', cfg.refreshTtlSeconds)
      .sadd(userKey(userId), familyId)
      .expire(userKey(userId), cfg.refreshTtlSeconds)
      .exec();
    return `${familyId}.${tokenId}`;
  }

  async function rotate(token) {
    const [familyId, tokenId] = String(token || '').split('.');
    if (!familyId || !tokenId) throw Unauthorized('Invalid refresh token');
    const raw = await redis.get(famKey(familyId));
    if (!raw) throw Unauthorized('Session expired');
    const rec = JSON.parse(raw);
    if (rec.tokenId !== tokenId) {
      await revokeFamily(familyId, rec.userId); // reuse detected
      throw Unauthorized('Refresh token reuse detected; session revoked');
    }
    const next = await issue(rec.userId, familyId);
    return { userId: rec.userId, refreshToken: next };
  }

  async function revokeFamily(familyId, userId) {
    await redis.del(famKey(familyId));
    if (userId) await redis.srem(userKey(userId), familyId);
  }

  async function revoke(token) {
    const [familyId] = String(token || '').split('.');
    if (!familyId) return;
    const raw = await redis.get(famKey(familyId));
    await revokeFamily(familyId, raw ? JSON.parse(raw).userId : null);
  }

  const listSessions = (userId) => redis.smembers(userKey(userId));
  async function revokeAll(userId) {
    const fams = await redis.smembers(userKey(userId));
    if (fams.length) await redis.del(...fams.map(famKey));
    await redis.del(userKey(userId));
    return fams.length;
  }

  return { issue, rotate, revoke, listSessions, revokeAll };
}

module.exports = { signAccess, createTokenStore };
