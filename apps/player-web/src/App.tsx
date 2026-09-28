import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { Trap } from '@four-chess/engine';
import { changePassword, clearSession, getStoredUser, getToken, User } from './api';
import { GAME_URL } from './config';
import { GameView, LobbyView } from './types';
import { Auth } from './components/Auth';
import { Lobbies } from './components/Lobbies';
import { Room } from './components/Room';
import { Game } from './components/Game';

type View = 'lobbies' | 'room' | 'game';

function ChangePasswordCard({ onClose, notify }: { onClose: () => void; notify: (msg: string) => void }) {
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await changePassword(oldPw, newPw);
      notify('Password changed ✓');
      onClose();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <form className="pw-card" onSubmit={submit}>
      <b>Change password</b>
      <input
        type="password"
        placeholder="Current password"
        value={oldPw}
        onChange={(e) => setOldPw(e.target.value)}
        required
      />
      <input
        type="password"
        placeholder="New password (min 6 chars)"
        value={newPw}
        onChange={(e) => setNewPw(e.target.value)}
        required
      />
      {error && <span className="error">{error}</span>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn primary small">Save</button>
        <button type="button" className="btn subtle small" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(getStoredUser());
  const [connected, setConnected] = useState(false);
  const [view, setView] = useState<View>('lobbies');
  const [lobbies, setLobbies] = useState<LobbyView[]>([]);
  const [lobby, setLobby] = useState<LobbyView | null>(null);
  const [game, setGame] = useState<GameView | null>(null);
  const [myTraps, setMyTraps] = useState<Trap[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    if (!user) return;
    const socket = io(GAME_URL, { auth: { token: getToken() } });
    socketRef.current = socket;
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', (e) => {
      if (String(e.message).includes('Not authenticated')) {
        clearSession();
        setUser(null);
      }
    });
    socket.on('lobbies', (list: LobbyView[]) => setLobbies(list));
    socket.on('lobby:state', (l: LobbyView) => {
      setLobby((prev) => (prev && prev.id === l.id ? l : prev ?? l));
    });
    socket.on(
      'session:restore',
      ({ lobby, game, myTraps }: { lobby: LobbyView; game: GameView | null; myTraps?: Trap[] }) => {
        setLobby(lobby);
        setMyTraps(myTraps ?? []);
        if (game) {
          setGame(game);
          setView('game');
        } else {
          setView('room');
        }
      },
    );
    socket.on('game:started', ({ gameId }: { gameId: string }) => {
      socket.emit('game:join', { gameId }, (res: any) => {
        if (res?.ok) {
          setGame(res.game);
          setMyTraps(res.myTraps ?? []);
          setView('game');
        }
      });
    });
    socket.on('game:state', (g: GameView) => {
      setGame((prev) => (prev && prev.id !== g.id ? prev : g));
    });
    socket.on('game:private', ({ gameId, traps }: { gameId: string; traps: Trap[] }) => {
      setGame((prev) => {
        if (prev && prev.id === gameId) setMyTraps(traps);
        return prev;
      });
    });
    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [user]);

  const emit = useCallback(
    (event: string, payload: Record<string, unknown> = {}): Promise<any> =>
      new Promise((resolve) => {
        const socket = socketRef.current;
        if (!socket || !socket.connected) {
          showToast('Not connected to the game server — reconnecting, try again in a moment');
          return resolve({ ok: false, error: 'Not connected' });
        }
        let done = false;
        const timer = setTimeout(() => {
          if (done) return;
          done = true;
          showToast('The game server did not respond — check your connection and try again');
          resolve({ ok: false, error: 'Timed out' });
        }, 8000);
        socket.emit(event, payload, (res: any) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (res && res.ok === false) showToast(res.error ?? 'Something went wrong');
          resolve(res);
        });
      }),
    [showToast],
  );

  if (!user) {
    return <Auth onLogin={setUser} />;
  }

  const logout = () => {
    emit('lobby:leave');
    clearSession();
    setUser(null);
    setLobby(null);
    setGame(null);
    setView('lobbies');
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">♛</span> Four Chess
        </div>
        <div className="topbar-right">
          <span className={`conn-dot ${connected ? 'on' : 'off'}`} title={connected ? 'Connected' : 'Disconnected'} />
          <span className="username">{user.username}</span>
          <button className="btn subtle" title="Change password" onClick={() => setShowPw((v) => !v)}>
            🔑
          </button>
          <button className="btn subtle" onClick={logout}>
            Log out
          </button>
        </div>
      </header>
      {showPw && <ChangePasswordCard onClose={() => setShowPw(false)} notify={showToast} />}
      {!connected && (
        <div className="reconnect-banner">
          ⚠ Connection to the game server lost — reconnecting… (creating and joining groups is paused)
        </div>
      )}
      <main className="content">
        {view === 'lobbies' && (
          <Lobbies
            me={user}
            lobbies={lobbies}
            connected={connected}
            emit={emit}
            onWatch={async (gameId) => {
              const res = await emit('game:join', { gameId });
              if (res?.ok) {
                setGame(res.game);
                setMyTraps(res.myTraps ?? []);
                setView('game');
              }
            }}
            onCreate={async (name, mode, open, autopilot, powers) => {
              const res = await emit('lobby:create', { name, mode, open, autopilot, powers });
              if (res?.ok) {
                setLobby(res.lobby);
                setView('room');
              }
            }}
            onJoin={async (lobbyId) => {
              const res = await emit('lobby:join', { lobbyId });
              if (res?.ok) {
                setLobby(res.lobby);
                setView(res.lobby.status === 'playing' ? 'game' : 'room');
              }
            }}
          />
        )}
        {view === 'room' && lobby && (
          <Room
            lobby={lobby}
            me={user}
            emit={emit}
            onLeave={async () => {
              await emit('lobby:leave');
              setLobby(null);
              setView('lobbies');
            }}
          />
        )}
        {view === 'game' && game && (
          <Game
            game={game}
            me={user}
            myTraps={myTraps}
            socket={socketRef.current}
            emit={emit}
            onExit={async () => {
              await emit('lobby:leave');
              setLobby(null);
              setGame(null);
              setView('lobbies');
            }}
            onBackToRoom={() => {
              setGame(null);
              setView('room');
            }}
          />
        )}
      </main>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
