import { FormEvent, useState } from 'react';
import { resetPassword } from '../api';

// Landing page for password-reset links (/reset?token=...).
export function ResetPage() {
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) return setError('Passwords do not match');
    setBusy(true);
    try {
      const res = await resetPassword(token, password);
      setDone(res.username ?? '');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">♛</div>
        <h1>Reset password</h1>
        {done !== null ? (
          <div>
            <p className="muted">Password updated{done ? ` for ${done}` : ''}. You can log in now.</p>
            <a className="btn primary full" href="/" style={{ display: 'block', textDecoration: 'none' }}>
              Go to log in
            </a>
          </div>
        ) : !token ? (
          <p className="error">This reset link is missing its token. Request a new one from the login page.</p>
        ) : (
          <form onSubmit={submit}>
            <input
              type="password"
              placeholder="New password (min 6 chars)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <input
              type="password"
              placeholder="Repeat new password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
            {error && <div className="error">{error}</div>}
            <button className="btn primary full" disabled={busy}>
              {busy ? '…' : 'Set new password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
