import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';

vi.mock('../api', () => ({ api: { get: vi.fn(), post: vi.fn() }, errorMessage: (e) => e?.response?.data?.error?.message || e.message }));
vi.mock('../auth', () => ({ useAuth: () => ({ can: () => true, orgId: 'o1' }) }));
vi.mock('../hooks', () => ({ useMembers: () => ({ list: [], byId: {}, name: (id) => ({ u1: 'Ada', u2: 'Bob' }[id] || 'Unassigned') }) }));
vi.mock('../socket', () => ({ useSocket: () => ({ online: new Set() }) }));
vi.mock('../toast', () => ({ toast: vi.fn() }));
import { api } from '../api';
import { toast } from '../toast';
import Board from '../pages/Board';

const project = { _id: 'p1', name: 'Roadmap', status: 'ACTIVE', members: ['u1', 'u2'] };
const seed = () => [
  { _id: 't1', title: 'Write docs', status: 'TODO', priority: 'HIGH', assignedTo: 'u1', version: 1 },
  { _id: 't2', title: 'Fix bug', status: 'DONE', priority: 'LOW', assignedTo: 'u2', version: 3 },
];
let tasks = seed(); // acts as the "server" state
function mockGets() {
  api.get.mockImplementation(async (url) => {
    if (url.startsWith('/projects/')) return { data: { project } };
    if (url.startsWith('/tasks?')) return { data: { items: tasks } };
    if (url.startsWith('/notifications/presence')) return { data: { online: ['u1'] } };
    return { data: {} };
  });
}
const renderBoard = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={['/projects/p1']}><Routes><Route path="/projects/:id" element={<Board />} /></Routes></MemoryRouter>
  </QueryClientProvider>,
);
const col = (s) => within(screen.getByTestId(`col-${s}`));

beforeEach(() => { vi.clearAllMocks(); tasks = seed(); mockGets(); });

test('renders tasks in their status columns with presence for online members', async () => {
  renderBoard();
  expect(await col('TODO').findByText('Write docs')).toBeInTheDocument();
  expect(col('DONE').getByText('Fix bug')).toBeInTheDocument();
  expect(await screen.findByTestId('online-dot')).toBeInTheDocument(); // Ada is online
});

test('dragging a card sends the status change with the version it saw (optimistic update)', async () => {
  let release;
  api.post.mockImplementation(() => new Promise((resolve) => { release = () => { tasks = tasks.map((t) => (t._id === 't1' ? { ...t, status: 'IN_PROGRESS', version: 2 } : t)); resolve({ data: {} }); }; }));
  renderBoard();
  const card = (await col('TODO').findByText('Write docs')).closest('article');
  fireEvent.dragStart(card);
  fireEvent.drop(screen.getByTestId('col-IN_PROGRESS'));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/tasks/t1/status', { status: 'IN_PROGRESS', version: 1 }));
  // optimistic: the card has already moved while the server has not answered yet
  expect(await col('IN_PROGRESS').findByText('Write docs')).toBeInTheDocument();
  release(); // server confirms; refetched state agrees
  await waitFor(() => expect(col('IN_PROGRESS').getByText('Write docs')).toBeInTheDocument());
});

test('a 409 conflict rolls the card back and tells the user', async () => {
  api.post.mockRejectedValue({ response: { status: 409, data: { error: { message: 'conflict' } } } });
  renderBoard();
  const card = (await col('TODO').findByText('Write docs')).closest('article');
  fireEvent.dragStart(card);
  fireEvent.drop(screen.getByTestId('col-IN_PROGRESS'));
  await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/changed this task/i), 'error'));
  expect(await col('TODO').findByText('Write docs')).toBeInTheDocument();
});

test('priority filter hides non-matching tasks', async () => {
  renderBoard();
  await col('TODO').findByText('Write docs');
  fireEvent.change(screen.getByLabelText('Filter by priority'), { target: { value: 'LOW' } });
  expect(screen.queryByText('Write docs')).toBeNull();
  expect(screen.getByText('Fix bug')).toBeInTheDocument();
});
