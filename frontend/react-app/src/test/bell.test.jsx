import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';

vi.mock('../api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../socket', () => ({ useSocket: () => ({ socket: null }) }));
vi.mock('../toast', () => ({ toast: vi.fn() }));
import { api } from '../api';
import NotificationBell from '../components/NotificationBell';

const items = [
  { _id: 'n1', message: 'You were assigned: Ship it', isRead: false, createdAt: new Date().toISOString() },
  { _id: 'n2', message: 'You were mentioned on: Docs', isRead: false, createdAt: new Date().toISOString() },
];
const renderBell = () => render(<QueryClientProvider client={new QueryClient()}><NotificationBell /></QueryClientProvider>);

test('shows the unread badge and marks a notification read', async () => {
  api.get.mockResolvedValue({ data: { items, unreadCount: 2 } });
  api.post.mockResolvedValue({ data: { read: true, count: 1 } });
  renderBell();
  expect(await screen.findByTestId('unread-badge')).toHaveTextContent('2');
  fireEvent.click(screen.getByLabelText('Notifications'));
  fireEvent.click(await screen.findByText(/You were assigned/));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/notifications/n1/read'));
  await waitFor(() => expect(screen.getByTestId('unread-badge')).toHaveTextContent('1'));
});

test('mark all read clears the badge', async () => {
  api.get.mockResolvedValue({ data: { items, unreadCount: 2 } });
  api.post.mockResolvedValue({ data: { count: 0 } });
  renderBell();
  fireEvent.click(await screen.findByLabelText('Notifications'));
  fireEvent.click(await screen.findByText('Mark all read'));
  await waitFor(() => expect(screen.queryByTestId('unread-badge')).toBeNull());
});
