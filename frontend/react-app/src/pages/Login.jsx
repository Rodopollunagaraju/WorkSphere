import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { errorMessage } from '../api';

export default function Login() {
  const { login } = useAuth(); const nav = useNavigate(); const loc = useLocation();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await login(email, password); nav(loc.state?.from || '/', { replace: true }); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <div className="mx-auto mt-24 max-w-sm card">
      <h1 className="mb-4 text-xl font-semibold">Log in to WorkSphere</h1>
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-sm">Email<input className="input mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label className="block text-sm">Password<input className="input mt-1" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <button className="btn w-full" disabled={busy}>{busy ? 'Signing in…' : 'Log in'}</button>
      </form>
      <p className="mt-3 text-sm">No account? <Link className="text-indigo-600" to="/register">Register</Link></p>
    </div>
  );
}
