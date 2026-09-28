// Verifies the finish flow: 4 humans join one group, three resign -> last one wins.
import { io } from 'socket.io-client';

const API = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
const GAME = API;
const rnd = Math.random().toString(36).slice(2, 7);

async function makeUser(name) {
  const r = await fetch(`${API}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${name}-${rnd}@test.com`, username: `${name}_${rnd}`, password: 'secret1' }),
  }).then((x) => x.json());
  if (!r.token) throw new Error('signup failed: ' + JSON.stringify(r));
  const socket = io(GAME, { auth: { token: r.token } });
  await new Promise((res, rej) => {
    socket.on('connect', res);
    socket.on('connect_error', rej);
  });
  const emit = (event, payload) =>
    new Promise((resolve, reject) =>
      socket.emit(event, payload, (res) => (res && res.ok === false ? reject(new Error(`${event}: ${res.error}`)) : resolve(res))),
    );
  return { name, socket, emit, user: r.user };
}

const [bob, carol, dave, erin] = await Promise.all(['bob', 'carol', 'dave', 'erin'].map(makeUser));
const { lobby } = await bob.emit('lobby:create', { name: 'Winners circle', mode: 'ffa', open: true });
await carol.emit('lobby:join', { lobbyId: lobby.id });
await dave.emit('lobby:join', { lobbyId: lobby.id });
await erin.emit('lobby:join', { lobbyId: lobby.id });
console.log('4 humans seated');

let over = null;
bob.socket.on('game:over', (o) => (over = o));
let lastState = null;
bob.socket.on('game:state', (g) => (lastState = g.state));

const { gameId } = await bob.emit('lobby:start', { lobbyId: lobby.id });
await bob.emit('game:join', { gameId });
console.log('game started', gameId);

await carol.emit('game:resign', { gameId });
await dave.emit('game:resign', { gameId });
await erin.emit('game:resign', { gameId });
await new Promise((r) => setTimeout(r, 1500));

console.log('game:over payload:', JSON.stringify(over));
console.log('final winners:', JSON.stringify(lastState?.winners), 'eliminated:', JSON.stringify(lastState?.eliminated));
if (!over || !lastState?.winners?.includes('red')) throw new Error('expected red (bob) to win');
console.log(`OK: ${bob.user.username} (red) wins after three resignations`);
for (const u of [bob, carol, dave, erin]) u.socket.close();
process.exit(0);
