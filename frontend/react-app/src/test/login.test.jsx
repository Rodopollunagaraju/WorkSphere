import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

const login = vi.fn();
vi.mock('../auth', () => ({ useAuth: () => ({ login }) }));
import Login from '../pages/Login';

const fill = () => {
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'ada@example.com' } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password123' } });
  fireEvent.click(screen.getByRole('button', { name: /log in/i }));
};

test('submits credentials to login()', async () => {
  login.mockResolvedValueOnce();
  render(<MemoryRouter><Login /></MemoryRouter>);
  fill();
  await waitFor(() => expect(login).toHaveBeenCalledWith('ada@example.com', 'password123'));
});

test('shows the server error message when login fails', async () => {
  login.mockRejectedValueOnce({ response: { data: { error: { message: 'Invalid credentials' } } } });
  render(<MemoryRouter><Login /></MemoryRouter>);
  fill();
  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid credentials');
});
