// Two server instances (pods), two players, ONE game: proves shared Mongo
// state + change-stream broadcast fan-out across pods.
import { io } from 'socket.io-client';

const rnd = Math.random().toString(36).slice(2, 7);

async function connectAs(name, url) {
  const r = await fetch(`http://localhost:4000/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${name}-${rnd}@test.com`, username: `${name}_${rnd}`, password: 'secret1' }),
  }).then((x) => x.json());
  const socket = io(url, { auth: { token: r.token } });
  await new Promise((res, rej) => { socket.on('connect', res); socket.on('connect_error', rej); });
  const emit = (event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));
  return { socket, emit, user: r.user };
}

const A = await connectAs('podA', 'http://localhost:4000'); // pod 1
const B = await connectAs('podB', 'http://localhost:4001'); // pod 2
console.log('A on :4000, B on :4001');

const created = await A.emit('lobby:create', { name: 'Cross-pod duel', mode: 'duel', open: true });
if (!created.ok) throw new Error(created.error);
const joined = await B.emit('lobby:join', { lobbyId: created.lobby.id });
if (!joined.ok) throw new Error('B (other pod) could not join: ' + joined.error);
console.log('OK: B joined via the other pod');

const statesB = [];
const statesA = [];
B.socket.on('game:state', (g) => statesB.push(g.state.ply));
A.socket.on('game:state', (g) => statesA.push(g.state.ply));

const started = await A.emit('lobby:start', { lobbyId: created.lobby.id });
if (!started.ok) throw new Error(started.error);
await A.emit('game:join', { gameId: started.gameId });
await B.emit('game:join', { gameId: started.gameId });

const mvA = await A.emit('game:move', { gameId: started.gameId, from: { x: 7, y: 4 }, to: { x: 7, y: 6 } });
if (!mvA.ok) throw new Error('A move failed: ' + mvA.error);
await new Promise((r) => setTimeout(r, 1500));
if (!statesB.includes(1)) throw new Error('B never saw ply 1 across pods: ' + JSON.stringify(statesB));
console.log('OK: A moved on pod 1, B saw it on pod 2 (ply 1)');

const mvB = await B.emit('game:move', { gameId: started.gameId, from: { x: 7, y: 9 }, to: { x: 7, y: 7 } });
if (!mvB.ok) throw new Error('B move failed: ' + mvB.error);
await new Promise((r) => setTimeout(r, 1500));
if (!statesA.includes(2)) throw new Error('A never saw ply 2 across pods: ' + JSON.stringify(statesA));
console.log('OK: B moved on pod 2, A saw it on pod 1 (ply 2)');

console.log('CROSS-POD GAME WORKS');
A.socket.close(); B.socket.close();
process.exit(0);
