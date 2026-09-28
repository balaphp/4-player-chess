// End-to-end smoke test: signup -> create group -> seat 3 AIs -> start -> play vs AI.
// Usage: bun scripts/e2e-game.mjs   (server running; BASE_URL or PORT selects which one)
import { io } from 'socket.io-client';

const API = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
const GAME = API;

const rnd = Math.random().toString(36).slice(2, 8);
const signup = await fetch(`${API}/api/auth/signup`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: `e2e-${rnd}@test.com`, username: `e2e_${rnd}`, password: 'secret1' }),
}).then((r) => r.json());
if (!signup.token) throw new Error('signup failed: ' + JSON.stringify(signup));
console.log('signed up as', signup.user.username);

const socket = io(GAME, { auth: { token: signup.token } });
const emit = (event, payload) =>
  new Promise((resolve, reject) => {
    socket.emit(event, payload, (res) => (res && res.ok === false ? reject(new Error(`${event}: ${res.error}`)) : resolve(res)));
  });

await new Promise((res, rej) => {
  socket.on('connect', res);
  socket.on('connect_error', rej);
});
console.log('socket connected');

const { lobby } = await emit('lobby:create', { name: 'E2E test group', mode: 'ffa', open: true });
console.log('lobby created', lobby.id, 'seats:', JSON.stringify(lobby.seats.red));
for (const color of ['blue', 'yellow', 'green']) {
  await emit('lobby:setAI', { lobbyId: lobby.id, color, on: true, difficulty: 'medium' });
}
console.log('3 AI seated');

let states = 0;
let lastState = null;
socket.on('game:state', ({ state }) => {
  states++;
  lastState = state;
  console.log(`state #${states}: ply=${state.ply} turn=${state.turn} alive=${state.alive.join(',')} last=${state.lastMove?.notation}`);
});
socket.on('game:over', (o) => console.log('GAME OVER', JSON.stringify(o)));

const started = await emit('lobby:start', { lobbyId: lobby.id });
console.log('game started', started.gameId);
const { game } = await emit('game:join', { gameId: started.gameId });
console.log('joined game, initial turn:', game.state.turn);

// It's red's (our) turn first: play h2-h4.
await emit('game:move', { gameId: started.gameId, from: { x: 7, y: 1 }, to: { x: 7, y: 3 } });
console.log('played h2-h4, waiting for the three AI replies...');

await new Promise((res) => setTimeout(res, 6000));
if (!lastState) throw new Error('never received a game state');
if (lastState.ply < 4) throw new Error(`expected at least 4 plies (us + 3 AI), got ${lastState.ply}`);
if (lastState.turn !== 'red') throw new Error(`expected turn back to red, got ${lastState.turn}`);
console.log('OK: AI players responded, turn returned to red. Resigning to finish.');
await emit('game:resign', { gameId: started.gameId });
await new Promise((res) => setTimeout(res, 8000));
console.log(`final: ply=${lastState.ply} winners=${JSON.stringify(lastState.winners)} alive=${lastState.alive.join(',')}`);
socket.close();
process.exit(0);
