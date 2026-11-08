import { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { tokens } from './api';
import { useAuth } from './auth';

const Ctx = createContext({ socket: null, online: new Set() });
export const useSocket = () => useContext(Ctx);

// One socket per organization session. On reconnect we refetch (REST) anything missed while offline.
export function SocketProvider({ children }) {
  const { orgId } = useAuth();
  const qc = useQueryClient();
  const [socket, setSocket] = useState(null);
  const [online, setOnline] = useState(new Set());

  useEffect(() => {
    if (!orgId) return undefined;
    const s = io('/', { path: '/socket.io', auth: (cb) => cb({ token: tokens.get() }), reconnectionDelayMax: 5000 });
    s.on('connect', () => { qc.invalidateQueries({ queryKey: ['notifications'] }); qc.invalidateQueries({ queryKey: ['presence'] }); });
    s.on('presence', ({ userId, online: on }) => setOnline((prev) => { const n = new Set(prev); on ? n.add(userId) : n.delete(userId); return n; }));
    const beat = setInterval(() => s.emit('heartbeat'), 20000);
    setSocket(s);
    return () => { clearInterval(beat); s.disconnect(); setSocket(null); setOnline(new Set()); };
  }, [orgId, qc]);

  return <Ctx.Provider value={{ socket, online, setOnline }}>{children}</Ctx.Provider>;
}
