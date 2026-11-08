if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) throw new Error('JWT_SECRET must be set in production');
module.exports = {
  port: Number(process.env.PORT || 4001),
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/worksphere_auth?replicaSet=rs0',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret',
  accessTtl: process.env.ACCESS_TTL || '15m',
  refreshTtlSeconds: Number(process.env.REFRESH_TTL_SECONDS || 7 * 24 * 3600),
  inviteTtlHours: 72,
};
