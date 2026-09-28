// Verifies in-game text chat: players write, everyone in the game reads,
// outsiders can read a public game but not write, and spam is refused.
// Usage: bun scripts/e2e-chat.mjs   (server running; BASE_URL or PORT selects which one)
import { io } from 'socket.io-client';

const API = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
const rnd = Math.random().toString(36).slice(2, 7);

async function makeUser(name) {
  const r = await fetch(`${API}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${name}-${rnd}@test.com`, username: `${name}_${rnd}`, password: 'secret1' }),
  }).then((x) => x.json());
  if (!r.token) throw new Error('signup failed: ' + JSON.stringify(r));
  const socket = io(API, { auth: { token: r.token } });
  await new Promise((res, rej) => {
    socket.on('connect', res);
    socket.on('connect_error', rej);
  });
  // resolves with the raw answer, refusals included
  const ask = (event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));
  const emit = async (event, payload) => {
    const res = await ask(event, payload);
    if (res && res.ok === false) throw new Error(`${event}: ${res.error}`);
    return res;
  };
  const inbox = [];
  socket.on('chat:message', (m) => inbox.push(m));
  return { name, socket, ask, emit, inbox, user: r.user };
}

const expect = (condition, message) => {
  if (!condition) throw new Error('FAILED: ' + message);
  console.log('OK: ' + message);
};
const settle = () => new Promise((r) => setTimeout(r, 400));

const [ann, ben, viewer] = await Promise.all(['ann', 'ben', 'viewer'].map(makeUser));
const { lobby } = await ann.emit('lobby:create', { name: 'Chat test', mode: 'duel', open: true });
await ben.emit('lobby:join', { lobbyId: lobby.id });
const { gameId } = await ann.emit('lobby:start', { lobbyId: lobby.id });
await ann.emit('game:join', { gameId });
await ben.emit('game:join', { gameId });
await viewer.emit('game:join', { gameId });
console.log('game started', gameId);

await ann.emit('chat:send', { gameId, text: '  good   luck!  ' });
await ben.emit('chat:send', { gameId, text: 'you too' });
await settle();

for (const u of [ann, ben, viewer]) {
  expect(u.inbox.length === 2, `${u.name} received both messages`);
}
expect(ann.inbox[0].text === 'good luck!', 'whitespace is trimmed and collapsed');
expect(ann.inbox[0].username === ann.user.username && ann.inbox[0].color === 'red', 'a message carries its author and seat');
expect(ann.inbox[1].color === 'yellow', "the second player's seat is yellow");

const history = await viewer.emit('chat:history', { gameId });
expect(history.messages.length === 2 && history.messages[0].text === 'good luck!', 'history returns the messages, oldest first');

const fromViewer = await viewer.ask('chat:send', { gameId, text: 'hello from the stands' });
expect(fromViewer.ok === false && /players/.test(fromViewer.error), `a spectator cannot write: ${fromViewer.error}`);

const empty = await ann.ask('chat:send', { gameId, text: '    ' });
expect(empty.ok === false, `an empty message is refused: ${empty.error}`);

const long = await ann.emit('chat:send', { gameId, text: 'x'.repeat(1000) });
await settle();
expect(long.ok && ann.inbox.at(-1).text.length === 300, 'a long message is cut to 300 characters');

const burst = await Promise.all(Array.from({ length: 10 }, (_, i) => ben.ask('chat:send', { gameId, text: `spam ${i}` })));
const refused = burst.filter((r) => r.ok === false);
expect(refused.length > 0 && /quickly/.test(refused[0].error), `a burst is rate limited (${refused.length} of 10 refused)`);

const missing = await ann.ask('chat:send', { gameId: 'no-such-game', text: 'hi' });
expect(missing.ok === false, `an unknown game is refused: ${missing.error}`);

console.log('chat works');
for (const u of [ann, ben, viewer]) u.socket.close();
process.exit(0);
