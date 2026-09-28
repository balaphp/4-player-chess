// Verifies autopilot/watch mode: 1 human (autopilot on) + 3 AI -> game plays itself.
// Also checks that manual moves are blocked while autopilot is on, and that
// turning autopilot off mid-game hands control back.
import { io } from 'socket.io-client';

const API = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
const GAME = API;
const rnd = Math.random().toString(36).slice(2, 8);

const r = await fetch(`${API}/api/auth/signup`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: `ap-${rnd}@test.com`, username: `ap_${rnd}`, password: 'secret1' }),
}).then((x) => x.json());
if (!r.token) throw new Error('signup failed');

const socket = io(GAME, { auth: { token: r.token } });
const emit = (event, payload) =>
  new Promise((resolve) => socket.emit(event, payload, resolve));
await new Promise((res, rej) => {
  socket.on('connect', res);
  socket.on('connect_error', rej);
});

let lastState = null;
socket.on('game:state', (g) => (lastState = g.state));

const created = await emit('lobby:create', { name: 'Autopilot test', mode: 'ffa', open: true, autopilot: true });
if (!created.ok) throw new Error(created.error);
if (created.lobby.seats.red.autopilot !== true) throw new Error('creator seat should have autopilot on');
for (const color of ['blue', 'yellow', 'green']) {
  await emit('lobby:setAI', { lobbyId: created.lobby.id, color, on: true, difficulty: 'medium' });
}
const started = await emit('lobby:start', { lobbyId: created.lobby.id });
if (!started.ok) throw new Error(started.error);
await emit('game:join', { gameId: started.gameId });
console.log('game started with autopilot ON — waiting, making no moves...');

await new Promise((res) => setTimeout(res, 8000));
const plyA = lastState?.ply ?? 0;
console.log(`after 8s: ply=${plyA} turn=${lastState?.turn} lastMove=${lastState?.lastMove?.notation}`);
if (plyA < 4) throw new Error('expected the game to play itself past one full round');
const redMoves = lastState.history.filter((h) => h.color === 'red').length;
if (redMoves < 1) throw new Error('expected autopilot to have moved for red');
console.log(`OK: autopilot made ${redMoves} red move(s) without any human input`);

// Manual move must be rejected while autopilot is on.
const manual = await emit('game:move', { gameId: started.gameId, from: { x: 3, y: 1 }, to: { x: 3, y: 2 } });
if (manual.ok !== false || !/Autopilot/.test(manual.error ?? '')) {
  throw new Error('expected manual move to be blocked while autopilot is on, got ' + JSON.stringify(manual));
}
console.log('OK: manual move blocked while autopilot is on:', manual.error);

// Turn autopilot off: the game should stop advancing once it's red's turn.
await emit('game:setAutopilot', { gameId: started.gameId, on: false });
await new Promise((res) => setTimeout(res, 6000));
if (lastState.turn !== 'red' || lastState.winners) {
  console.log('note: game state', lastState.turn, lastState.winners);
  throw new Error('expected the game to be waiting on red after autopilot off');
}
const plyB = lastState.ply;
await new Promise((res) => setTimeout(res, 3000));
if (lastState.ply !== plyB) throw new Error('game advanced while waiting for the human');
console.log(`OK: autopilot off — game paused at ply=${plyB} waiting for red (the human)`);

socket.close();
process.exit(0);
