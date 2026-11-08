import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import NotificationBell from './components/NotificationBell';
import OrgSwitcher from './components/OrgSwitcher';
import Login from './pages/Login';
import Register from './pages/Register';
import AcceptInvite from './pages/AcceptInvite';
import Projects from './pages/Projects';
import Board from './pages/Board';
import Dashboard from './pages/Dashboard';
import Members from './pages/Members';

function Layout({ children }) {
  const { user, logout, orgId } = useAuth();
  return (
    <div className="min-h-screen">
      <header className="flex items-center gap-4 border-b bg-white px-6 py-3">
        <Link to="/" className="text-lg font-bold text-indigo-700">WorkSphere</Link>
        {orgId && <nav className="flex gap-4 text-sm"><Link to="/">Projects</Link><Link to="/dashboard">Dashboard</Link><Link to="/members">Members</Link></nav>}
        <div className="ml-auto flex items-center gap-3">
          <OrgSwitcher />{orgId && <NotificationBell />}
          <span className="text-sm text-slate-600">{user?.name}</span>
          <button className="btn-ghost" onClick={logout}>Log out</button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl p-6">{children}</main>
    </div>
  );
}

function Protected({ children }) {
  const { ready, user } = useAuth();
  const loc = useLocation();
  if (!ready) return <p className="p-6 text-slate-500">Loading…</p>;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname + loc.search }} replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/accept-invite" element={<Protected><AcceptInvite /></Protected>} />
      <Route path="/" element={<Protected><Projects /></Protected>} />
      <Route path="/projects/:id" element={<Protected><Board /></Protected>} />
      <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
      <Route path="/members" element={<Protected><Members /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
