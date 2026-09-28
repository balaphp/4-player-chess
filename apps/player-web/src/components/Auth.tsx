import { FormEvent, useState } from 'react';
import { forgotPassword, login, resetWithCode, signup, storeSession, User } from '../api';

export function Auth({ onLogin }: { onLogin: (u: User) => void }) {
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [sent, setSent] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [newPw, setNewPw] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const backToLogin = (msg: string | null = null) => {
    setMode('login');
    setSent(false);
    setCode('');
    setNewPw('');
    setError(null);
    setNotice(msg);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'forgot') {
        if (!sent) {
          await forgotPassword(identifier);
          setSent(true);
        } else {
          await resetWithCode(identifier, code, newPw);
          backToLogin('Password updated ✓ — log in with your new password.');
        }
      } else {
        const res =
          mode === 'login' ? await login(identifier, password) : await signup(email, username, password);
        storeSession(res.token, res.user);
        onLogin(res.user);
      }
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
        <h1>Four Chess</h1>
        <p className="muted">Four players. One board. Last king standing — or best tag team — wins.</p>
        <div className="tabs">
          <button className={mode === 'login' ? 'tab active' : 'tab'} onClick={() => backToLogin()}>
            Log in
          </button>
          <button className={mode === 'signup' ? 'tab active' : 'tab'} onClick={() => { setMode('signup'); setSent(false); setNotice(null); }}>
            Sign up
          </button>
        </div>
        <form onSubmit={submit}>
          {mode !== 'signup' ? (
            <input
              placeholder="Email or username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              disabled={mode === 'forgot' && sent}
              required
            />
          ) : (
            <>
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <input
                placeholder="Username (3-20 chars)"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </>
          )}
          {mode === 'forgot' && sent && (
            <>
              <p className="muted">
                If that account exists, a 6-digit code was emailed to it (valid 10 minutes). No email? Ask
                an admin for a reset link.
              </p>
              <input
                placeholder="6-digit code"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
              <input
                type="password"
                placeholder="New password (min 6 chars)"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                required
              />
            </>
          )}
          {mode !== 'forgot' && (
            <input
              type="password"
              placeholder="Password (min 6 chars)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          )}
          {notice && <div className="muted">{notice}</div>}
          {error && <div className="error">{error}</div>}
          <button className="btn primary full" disabled={busy}>
            {busy
              ? '…'
              : mode === 'login'
                ? 'Log in'
                : mode === 'signup'
                  ? 'Create account'
                  : sent
                    ? 'Set new password'
                    : 'Email me a code'}
          </button>
          {mode === 'login' && (
            <button type="button" className="btn subtle full" onClick={() => { setMode('forgot'); setNotice(null); }}>
              Forgot password?
            </button>
          )}
          {mode === 'forgot' && (
            <button type="button" className="btn subtle full" onClick={() => backToLogin()}>
              Back to log in
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
