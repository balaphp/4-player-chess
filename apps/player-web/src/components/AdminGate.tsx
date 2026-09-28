import { FormEvent, lazy, Suspense, useState } from 'react';
import { clearSession, getStoredUser, login, storeSession, User } from '../api';

// Ships in the default bundle: just the login form and the role check.
// The console itself is a separate chunk, downloaded only once an actual
// admin is signed in.
const AdminConsole = lazy(() => import('./AdminConsole'));

export function AdminGate() {
  const [user, setUser] = useState<User | null>(getStoredUser());

  if (!user) return <AdminLogin onLogin={setUser} />;

  if (user.role !== 'admin') {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <h1>⛔ Admin only</h1>
          <p className="muted">
            You are logged in as <b>{user.username}</b>, which is not an admin account.
          </p>
          <button
            className="btn primary full"
            onClick={() => {
              clearSession();
              setUser(null);
            }}
          >
            Log in with a different account
          </button>
        </div>
      </div>
    );
  }

  return (
    <Suspense fallback={<p className="muted" style={{ padding: 24 }}>Loading admin console…</p>}>
      <AdminConsole
        user={user}
        onLogout={() => {
          clearSession();
          setUser(null);
        }}
      />
    </Suspense>
  );
}

function AdminLogin({ onLogin }: { onLogin: (u: User) => void }) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await login(identifier, password);
      storeSession(res.token, res.user);
      onLogin(res.user);
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <h1>♛ Admin console</h1>
        <p className="muted">Log in with an admin account.</p>
        <input placeholder="Email or username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <div className="error">{error}</div>}
        <button className="btn primary full">Log in</button>
      </form>
    </div>
  );
}
