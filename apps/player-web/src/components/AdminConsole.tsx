import { useCallback, useEffect, useState } from 'react';
import { request, User } from '../api';

// The admin console proper. Loaded lazily (its own chunk) by AdminGate, so
// none of this code ships in the bundle players download.
type Tab = 'dashboard' | 'users' | 'games' | 'players';

export default function AdminConsole({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('dashboard');

  return (
    <div className="admin">
      <header className="topbar">
        <div className="brand">♛ Four Chess — Admin</div>
        <nav className="tabs-nav">
          <button className={tab === 'dashboard' ? 'active' : ''} onClick={() => setTab('dashboard')}>
            Dashboard
          </button>
          <button className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>
            Users
          </button>
          <button className={tab === 'games' ? 'active' : ''} onClick={() => setTab('games')}>
            Games
          </button>
          <button className={tab === 'players' ? 'active' : ''} onClick={() => setTab('players')}>
            Players
          </button>
        </nav>
        <div className="topbar-right">
          <span className="muted">{user.username} (admin)</span>
          <button className="btn subtle" onClick={onLogout}>
            Log out
          </button>
        </div>
      </header>
      <main className="admin-content">
        {tab === 'dashboard' && <Dashboard />}
        {tab === 'users' && <Users me={user} />}
        {tab === 'games' && <Games />}
        {tab === 'players' && <PlayersTab />}
      </main>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="stat-card">
      <div className="stat-value">{value}</div>
      <div className="muted">{label}</div>
    </div>
  );
}

function seatSummary(seats: Record<string, any>): string {
  return ['red', 'blue', 'yellow', 'green']
    .map((c) => {
      const s = seats[c];
      if (!s) return `${c}: —`;
      return `${c}: ${s.kind === 'ai' ? `AI(${s.difficulty})` : s.username}`;
    })
    .join(' · ');
}

function Dashboard() {
  const [stats, setStats] = useState<any>(null);
  const [live, setLive] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    request('/api/admin/stats').then(setStats).catch((e) => setError(e.message));
    request('/api/live').then(setLive).catch(() => setLive(null));
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  if (error) return <p className="error">{error}</p>;
  if (!stats) return <p className="muted">Loading…</p>;

  return (
    <div>
      <div className="cards">
        <StatCard label="Users" value={stats.users} />
        <StatCard label="Active users" value={stats.activeUsers} />
        <StatCard label="Games played" value={stats.gamesFinished} />
        <StatCard label="Games live" value={stats.gamesActive} />
        <StatCard label="Open groups" value={live ? live.lobbies.filter((l: any) => l.status === 'waiting').length : '–'} />
      </div>
      <h2>Live games</h2>
      {!live || live.games.length === 0 ? (
        <p className="muted">No games in progress.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Group</th>
              <th>Mode</th>
              <th>Turn</th>
              <th>Moves</th>
              <th>Alive</th>
              <th>Players</th>
            </tr>
          </thead>
          <tbody>
            {live.games.map((g: any) => (
              <tr key={g.id}>
                <td>{g.groupName}</td>
                <td>{g.mode}</td>
                <td>{g.turn}</td>
                <td>{g.ply}</td>
                <td>{g.alive.join(', ')}</td>
                <td>{seatSummary(g.seats)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h2>Groups</h2>
      {!live || live.lobbies.length === 0 ? (
        <p className="muted">No groups.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Mode</th>
              <th>Status</th>
              <th>Seats</th>
            </tr>
          </thead>
          <tbody>
            {live.lobbies.map((l: any) => (
              <tr key={l.id}>
                <td>{l.name}</td>
                <td>{l.mode}</td>
                <td>{l.status}</td>
                <td>{seatSummary(l.seats)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Users({ me }: { me: User }) {
  const [users, setUsers] = useState<any[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [resetLink, setResetLink] = useState<{ username: string; url: string } | null>(null);

  const refresh = useCallback(() => {
    request('/api/admin/users')
      .then((r) => setUsers(r.users))
      .catch((e) => setError(e.message));
  }, []);

  useEffect(refresh, [refresh]);

  const update = async (id: string, patch: { active?: boolean; role?: string }) => {
    try {
      await request(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      refresh();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const shown = users.filter((u) => {
    const q = filter.trim().toLowerCase();
    return !q || u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });

  return (
    <div>
      <h2>Users</h2>
      <div className="search-row">
        <input placeholder="🔍 Filter by username or email…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      {error && <p className="error">{error}</p>}
      {resetLink && (
        <p className="muted" style={{ wordBreak: 'break-all' }}>
          Reset link for <b>{resetLink.username}</b> (valid 30 min — send it to them):{' '}
          <code>{resetLink.url}</code>
        </p>
      )}
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Username</th>
            <th>Email</th>
            <th>Role</th>
            <th>Status</th>
            <th>Joined</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((u) => (
            <tr key={u.id} className={u.active === false ? 'inactive' : ''}>
              <td title={u.id}>…{u.id.slice(-6)}</td>
              <td>{u.username}</td>
              <td>{u.email}</td>
              <td>{u.role}</td>
              <td>{u.active === false ? 'deactivated' : 'active'}</td>
              <td>{String(u.createdAt).slice(0, 10)}</td>
              <td>
                {u.id !== me.id && (
                  <span className="row-actions">
                    <button className="btn small" onClick={() => update(u.id, { active: u.active === false })}>
                      {u.active === false ? 'Reactivate' : 'Deactivate'}
                    </button>
                    <button
                      className="btn small subtle"
                      onClick={() => update(u.id, { role: u.role === 'admin' ? 'user' : 'admin' })}
                    >
                      {u.role === 'admin' ? 'Make user' : 'Make admin'}
                    </button>
                    <button
                      className="btn small subtle"
                      title="Generate a password-reset link to send to this user"
                      onClick={() =>
                        request(`/api/admin/users/${u.id}/reset-link`, { method: 'POST' })
                          .then((r) => setResetLink({ username: u.username, url: r.url }))
                          .catch((e) => setError(e.message))
                      }
                    >
                      Reset link
                    </button>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatScores(g: any): string {
  if (!g.scores) return '—';
  return g.players.map((p: any) => `${p.username}: ${g.scores[p.color] ?? 0}`).join(' · ');
}

function Games() {
  const [games, setGames] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    request('/api/admin/games')
      .then((r) => setGames(r.games))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <h2>Game history</h2>
      {error && <p className="error">{error}</p>}
      {games.length === 0 ? (
        <p className="muted">No games yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Group</th>
              <th>Mode</th>
              <th>Status</th>
              <th>Players</th>
              <th>Winners</th>
              <th>Scores</th>
              <th>Moves</th>
              <th>Started</th>
            </tr>
          </thead>
          <tbody>
            {games.map((g: any) => (
              <tr key={g.id}>
                <td>{g.groupName}</td>
                <td>{g.mode}</td>
                <td>{g.status}</td>
                <td>{g.players.map((p: any) => `${p.username} (${p.color})`).join(', ')}</td>
                <td>{g.winners && g.winners.length ? g.winners.join(' + ') : '—'}</td>
                <td>{formatScores(g)}</td>
                <td>{g.movesCount}</td>
                <td>{String(g.startedAt).slice(0, 19).replace('T', ' ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PlayersTab() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[] | null>(null);
  const [board, setBoard] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    request('/api/leaderboard')
      .then((r) => setBoard(r.leaderboard))
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    const t = setTimeout(() => {
      request(`/api/players?q=${encodeURIComponent(q)}`)
        .then((r) => setResults(r.players))
        .catch((e) => setError(e.message));
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const rows = results ?? board;

  return (
    <div>
      <h2>Players</h2>
      <div className="search-row">
        <input placeholder="🔍 Search players by username…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {error && <p className="error">{error}</p>}
      {rows.length === 0 ? (
        <p className="muted">{results ? `No players match “${query.trim()}”.` : 'No finished games yet.'}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th>Points</th>
              <th>Wins</th>
              <th>Games</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any) => (
              <tr key={r.userId ?? r.id}>
                <td>{r.username}</td>
                <td>{r.points}</td>
                <td>{r.wins}</td>
                <td>{r.games}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
