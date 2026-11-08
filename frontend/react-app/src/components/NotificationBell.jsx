import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useSocket } from '../socket';
import { toast } from '../toast';

export default function NotificationBell() {
  const qc = useQueryClient(); const { socket } = useSocket(); const [open, setOpen] = useState(false);
  const { data } = useQuery({ queryKey: ['notifications'], queryFn: async () => (await api.get('/notifications?limit=20')).data });

  useEffect(() => {
    if (!socket) return undefined;
    const onNew = (n) => { toast(n.message); qc.setQueryData(['notifications'], (old) => (old ? { ...old, items: [n, ...old.items.filter((i) => i._id !== n._id)] } : old)); };
    const onUnread = ({ count }) => qc.setQueryData(['notifications'], (old) => (old ? { ...old, unreadCount: count } : old));
    socket.on('notification', onNew); socket.on('unread', onUnread);
    return () => { socket.off('notification', onNew); socket.off('unread', onUnread); };
  }, [socket, qc]);

  const read = async (id) => { const { data: r } = await api.post(`/notifications/${id}/read`); qc.setQueryData(['notifications'], (old) => ({ ...old, unreadCount: r.count, items: old.items.map((i) => (i._id === id ? { ...i, isRead: true } : i)) })); };
  const readAll = async () => { await api.post('/notifications/read-all'); qc.setQueryData(['notifications'], (old) => ({ ...old, unreadCount: 0, items: old.items.map((i) => ({ ...i, isRead: true })) })); };
  const count = data?.unreadCount || 0;

  return (
    <div className="relative">
      <button aria-label="Notifications" className="btn-ghost relative" onClick={() => setOpen(!open)}>
        🔔{count > 0 && <span data-testid="unread-badge" className="ml-1 rounded-full bg-red-600 px-1.5 text-xs text-white">{count}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 max-h-96 w-80 overflow-auto card">
          <div className="mb-2 flex justify-between text-sm"><b>Notifications</b><button className="text-indigo-600" onClick={readAll}>Mark all read</button></div>
          {!data?.items?.length && <p className="text-sm text-slate-500">Nothing yet.</p>}
          {data?.items?.map((n) => (
            <button key={n._id} onClick={() => !n.isRead && read(n._id)} className={`block w-full border-b py-2 text-left text-sm ${n.isRead ? 'text-slate-500' : 'font-medium'}`}>
              {n.message}<div className="text-xs font-normal text-slate-400">{new Date(n.createdAt).toLocaleString()}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
