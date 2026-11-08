const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const jwt = require('jsonwebtoken');
const { presence } = require('@worksphere/redis');

// Redis adapter => emits reach sockets connected to ANY notification-service instance.
function createSocketServer(httpServer, { pub, sub, jwtSecret, redis, corsOrigin = '*' }) {
  const io = new Server(httpServer, { cors: { origin: corsOrigin }, path: '/socket.io' });
  io.adapter(createAdapter(pub, sub));

  io.use((socket, next) => {
    try {
      const c = jwt.verify(socket.handshake.auth && socket.handshake.auth.token, jwtSecret, { algorithms: ['HS256'] });
      if (!c.orgId) return next(new Error('organization required'));
      socket.data = { userId: c.sub, orgId: c.orgId };
      next();
    } catch { next(new Error('unauthorized')); }
  });

  io.on('connection', async (socket) => {
    const { userId, orgId } = socket.data;
    socket.join(`user:${orgId}:${userId}`);
    socket.join(`org:${orgId}`);
    await presence.heartbeat(redis, orgId, userId);
    io.to(`org:${orgId}`).emit('presence', { userId, online: true });
    socket.on('heartbeat', () => presence.heartbeat(redis, orgId, userId));
    socket.on('disconnect', async () => {
      const still = await io.in(`user:${orgId}:${userId}`).fetchSockets(); // other tabs/instances?
      if (!still.length) { await presence.remove(redis, orgId, userId); io.to(`org:${orgId}`).emit('presence', { userId, online: false }); }
    });
  });
  return { io, emitToUser: (org, user, event, payload) => io.to(`user:${org}:${user}`).emit(event, payload) };
}
module.exports = { createSocketServer };
