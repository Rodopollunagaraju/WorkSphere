import { useQuery } from '@tanstack/react-query';
import { api } from './api';

// Organization members as { list, name(id) } so IDs from events/tasks render as people.
export function useMembers() {
  const { data } = useQuery({ queryKey: ['members'], queryFn: async () => (await api.get('/auth/members')).data.members });
  const list = data || [];
  const byId = Object.fromEntries(list.map((m) => [String(m.userId), m]));
  return { list, byId, name: (id) => byId[String(id)]?.name || (id ? String(id).slice(0, 6) : 'Unassigned') };
}
