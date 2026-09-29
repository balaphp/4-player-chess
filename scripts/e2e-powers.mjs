// Powers are secret. Verifies what actually travels over the wire: an
// opponent and a spectator are never sent a wall, a trap, or any sign that a
// power was used; a shield shows to everyone without its end; a move that
// runs into a hidden wall is refused and reveals that wall to the mover only;
// a trap becomes public once it has gone off. Also: one power at a time.
// Usage: bun scripts/e2e-powers.mjs   (server running; BASE_URL or PORT selects which one)
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
  // everything the server pushes about the game, in order
  const received = [];
  socket.on('game:state', (game) => received.push({ event: 'game:state', game }));
  socket.on('game:private', (mine) => received.push({ event: 'game:private', mine }));
  const latest = (event) => received.filter((r) => r.event === event).at(-1);
  return { name, socket, ask, emit, received, latest, user: r.user };
}

const expect = (condition, message) => {
  if (!condition) throw new Error('FAILED: ' + message);
  console.log('OK: ' + message);
};
const settle = () => new Promise((r) => setTimeout(r, 400));
const at = (x, y) => (p) => p.x === x && p.y === y;

const [ann, ben, viewer] = await Promise.all(['ann', 'ben', 'viewer'].map(makeUser));
const others = [ben, viewer];
const { lobby } = await ann.emit('lobby:create', { name: 'Powers test', mode: 'duel', open: true, powers: true });
await ben.emit('lobby:join', { lobbyId: lobby.id });
const { gameId } = await ann.emit('lobby:start', { lobbyId: lobby.id });
const joined = {};
for (const u of [ann, ben, viewer]) joined[u.name] = await u.emit('game:join', { gameId });
console.log('game started', gameId, '- ann is red, ben is yellow, viewer watches');

expect(joined.ann.mine?.powers.length === 5, 'a player is told their own five powers');
expect(joined.viewer.mine === null, 'a spectator has nothing private');
expect(
  Object.values(joined.ben.game.state.powers).every((left) => left.length === 0),
  "the shared state lists nobody's unused powers",
);

// ---- red sets a wall: nobody else hears a thing ----
await settle();
const forget = () => [ann, ben, viewer].forEach((u) => (u.received.length = 0));
forget();
await ann.emit('game:power', { gameId, action: { power: 'wall', target: { x: 4, y: 7 } } });
await settle();

const annSees = ann.latest('game:private').mine;
expect(annSees.walls.some(at(4, 7)), 'the owner sees her wall');
expect(annSees.walls[0].until > annSees.ply + 1, 'and how long it lasts');
expect(annSees.powers.length === 4, 'and that four powers are left');
expect(!ann.received.some((r) => r.event === 'game:state'), 'the shared state did not change, so it was not sent again');
for (const u of others) expect(u.received.length === 0, `${u.name} received nothing at all while the wall was set`);

// ---- one power at a time ----
const second = await ann.ask('game:power', { gameId, action: { power: 'mine', target: { x: 5, y: 7 } } });
expect(second.ok === false && /one power at a time/i.test(second.error), `a second power is refused: ${second.error}`);
await settle();
expect(ann.latest('game:private').mine.powers.length === 4, 'and not used up');

await ann.emit('game:move', { gameId, from: { x: 3, y: 4 }, to: { x: 3, y: 5 } });
await settle();

// ---- yellow runs into the wall ----
forget();
const bump = await ben.ask('game:move', { gameId, from: { x: 4, y: 9 }, to: { x: 4, y: 7 } });
await settle();
expect(bump.ok === false && /hidden wall/i.test(bump.error), `the move is refused: ${bump.error}`);
const benSees = ben.latest('game:private')?.mine;
expect(benSees?.walls.some(at(4, 7)), 'yellow now sees the wall');
expect(benSees.walls.find(at(4, 7)).until === benSees.ply + 1, 'but not how long it lasts');
expect(!('knownTo' in benSees.walls.find(at(4, 7))), 'nor who else has found it');
expect(ann.received.length === 0, 'its owner is not told it was found');
expect(viewer.received.length === 0, 'the spectator is not told either');

// ---- yellow mines a square, in secret, and still has the move ----
forget();
await ben.emit('game:power', { gameId, action: { power: 'mine', target: { x: 5, y: 6 } } });
await settle();
expect(ben.latest('game:private').mine.traps.some(at(5, 6)), 'yellow sees his mine');
expect(ann.received.length === 0 && viewer.received.length === 0, 'nobody else received anything while it was set');
await ben.emit('game:move', { gameId, from: { x: 10, y: 9 }, to: { x: 10, y: 8 } });
await settle();

// ---- the shared state gives nothing away ----
for (const u of [ann, ben, viewer]) {
  const state = u.latest('game:state').game.state;
  expect(state.walls.length === 0 && state.traps.length === 0, `${u.name}: no wall or trap in the shared state`);
  expect(state.history.every((h) => !h.power), `${u.name}: no power use in the move history`);
  expect(!('rev' in state), `${u.name}: no counter that moves when a power is used`);
}
const sentToViewer = JSON.stringify([viewer.received, joined.viewer]);
expect(!/"type":"mine"/.test(sentToViewer) && !/"walls":\[\{/.test(sentToViewer), 'nothing sent to the spectator holds the mine or the wall');
expect(!/"type":"mine"/.test(JSON.stringify(ann.received)), "nothing sent to red holds yellow's mine");

// ---- red steps on the mine: from then on it is no secret ----
const step = await ann.ask('game:move', { gameId, from: { x: 5, y: 4 }, to: { x: 5, y: 6 } });
await settle();
expect(step.ok !== false, 'red plays a pawn to the mined square');
for (const u of [ann, ben, viewer]) {
  const state = u.latest('game:state').game.state;
  const last = state.history.at(-1);
  expect(last.sprung?.[0] === 'mine' && last.to.x === 5 && last.to.y === 6, `${u.name} is told the mine went off`);
  expect(!state.pieces.some(at(5, 6)), `${u.name}: the pawn is gone`);
}
expect(ben.latest('game:private').mine.traps.length === 0, 'the mine is spent');

// ---- so yellow may set the next: a shield shows to everyone, but only its owner learns its end ----
await ben.emit('game:power', { gameId, action: { power: 'shield', target: { x: 7, y: 10 } } });
await settle();
for (const u of [ann, viewer]) {
  const state = u.latest('game:state').game.state;
  const shield = state.shields.find(at(7, 10));
  expect(shield && shield.color === 'yellow', `${u.name} sees the shield`);
  expect(shield.until === state.ply + 1, `${u.name} is not told how long it lasts`);
}
const annShield = ann.latest('game:private').mine.shields.find(at(7, 10));
expect(annShield.until === ann.latest('game:private').mine.ply + 1, "red's own copy does not tell either");
const ownShield = ben.latest('game:private').mine.shields.find(at(7, 10));
expect(ownShield.until > ben.latest('game:private').mine.ply + 1, 'the owner is told');

// both leave, which ends the game and closes the group: nothing stays listed
await ann.emit('lobby:leave');
await ben.emit('lobby:leave');
for (const u of [ann, ben, viewer]) u.socket.close();
console.log('powers stay secret');
process.exit(0);
