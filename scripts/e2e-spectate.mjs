// Spectating rules: public games watchable by anyone, private games only by
// their players and admins.
// Needs the database as well as the server: there is no built-in admin, so
// the test promotes one of its own throwaway accounts directly.
import { createRequire } from 'node:module';
import { io } from 'socket.io-client';

const API = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
const MONGO_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/?directConnection=true';
const DB_NAME = process.env.FOUR_CHESS_DB_NAME ?? 'four-chess';
const rnd = Math.random().toString(36).slice(2, 7);

// the driver is installed for the server package
const { MongoClient } = createRequire(new URL('../apps/server/package.json', import.meta.url))('mongodb');

async function withUsers(fn) {
  const client = await MongoClient.connect(MONGO_URI);
  try {
    return await fn(client.db(DB_NAME).collection('users'));
  } finally {
    await client.close();
  }
}

const makeAdmin = (email) =>
  withUsers(async (users) => {
    const res = await users.updateOne({ email }, { $set: { role: 'admin' } });
    if (res.matchedCount !== 1) throw new Error(`no account with email ${email}`);
  });

// the test must not leave an admin with a known password behind
const removeAccount = (email) => withUsers((users) => users.deleteOne({ email }));

async function connectAs(identifier, password, signup = true) {
  const body = signup
    ? { email: `${identifier}@test.com`, username: identifier, password }
    : { identifier, password };
  const r = await fetch(`${API}/api/auth/${signup ? 'signup' : 'login'}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((x) => x.json());
  if (!r.token) throw new Error(`auth failed for ${identifier}: ${JSON.stringify(r)}`);
  const socket = io(API, { auth: { token: r.token } });
  await new Promise((res, rej) => {
    socket.on('connect', res);
    socket.on('connect_error', rej);
  });
  const emit = (event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));
  return { socket, emit, user: r.user };
}

async function startAiGame(host, name, open) {
  const created = await host.emit('lobby:create', { name, mode: 'ffa', open, autopilot: true });
  if (!created.ok) throw new Error(created.error);
  for (const color of ['blue', 'yellow', 'green']) {
    await host.emit('lobby:setAI', { lobbyId: created.lobby.id, color, on: true, difficulty: 'easy' });
  }
  const started = await host.emit('lobby:start', { lobbyId: created.lobby.id });
  if (!started.ok) throw new Error(started.error);
  return started.gameId;
}

const hostA = await connectAs(`pub_${rnd}`, 'secret1');
const hostB = await connectAs(`priv_${rnd}`, 'secret1');
const viewer = await connectAs(`view_${rnd}`, 'secret1');
// an admin: register, promote, then sign in again so the session carries the role
const registered = await connectAs(`adm_${rnd}`, 'secret1');
registered.socket.close();
await makeAdmin(registered.user.email);
const admin = await connectAs(`adm_${rnd}`, 'secret1', false);
if (admin.user.role !== 'admin') throw new Error('the promoted account should sign in as admin');

const publicGame = await startAiGame(hostA, 'Public arena', true);
const privateGame = await startAiGame(hostB, 'Secret arena', false);
console.log('started public', publicGame, '/ private', privateGame);

// A regular viewer only sees the public game...
const viewerList = await viewer.emit('games:list', {});
const names = viewerList.map((g) => g.groupName).sort();
if (names.includes('Secret arena')) throw new Error('private game leaked into public list');
if (!names.includes('Public arena')) throw new Error('public game missing from list');
console.log('OK: viewer list shows only public games:', names.join(', '));

// ...can watch it...
const watchPub = await viewer.emit('game:join', { gameId: publicGame });
if (!watchPub.ok) throw new Error('viewer should be able to watch a public game');
console.log('OK: viewer watches the public game (state ply', watchPub.game.state.ply + ')');

// ...but is refused on the private one.
const watchPriv = await viewer.emit('game:join', { gameId: privateGame });
if (watchPriv.ok !== false || !/private/.test(watchPriv.error)) {
  throw new Error('viewer should be refused on a private game, got ' + JSON.stringify(watchPriv));
}
console.log('OK: viewer refused on the private game:', watchPriv.error);

// The admin sees and can watch everything.
const adminList = await admin.emit('games:list', {});
const adminNames = adminList.map((g) => g.groupName);
if (!adminNames.includes('Secret arena')) throw new Error('admin should see private games');
const adminWatch = await admin.emit('game:join', { gameId: privateGame });
if (!adminWatch.ok) throw new Error('admin should be able to watch a private game');
console.log('OK: admin sees', adminList.length, 'games and watches the private one');

for (const c of [hostA, hostB, viewer, admin]) c.socket.close();
await removeAccount(admin.user.email);
process.exit(0);
