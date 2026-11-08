import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { errorMessage } from '../api';

export default function Register() {
  const { register } = useAuth(); const nav = useNavigate();
  const [f, setF] = useState({ name: '', email: '', password: '' }); const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => { e.preventDefault(); setError(''); try { await register(f.name, f.email, f.password); nav('/'); } catch (err) { setError(errorMessage(err)); } };
  return (
    <div className="mx-auto mt-24 max-w-sm card">
      <h1 className="mb-4 text-xl font-semibold">Create your account</h1>
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-sm">Name<input className="input mt-1" value={f.name} onChange={set('name')} required /></label>
        <label className="block text-sm">Email<input className="input mt-1" type="email" value={f.email} onChange={set('email')} required /></label>
        <label className="block text-sm">Password (8+ characters)<input className="input mt-1" type="password" minLength={8} value={f.password} onChange={set('password')} required /></label>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <button className="btn w-full">Register</button>
      </form>
      <p className="mt-3 text-sm">Have an account? <Link className="text-indigo-600" to="/login">Log in</Link></p>
    </div>
  );
}
