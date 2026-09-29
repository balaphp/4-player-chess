# Four Chess — 4-player chess platform

A web-first 4-player chess platform: sign up, create or join open groups, and play
4 vs 4 or 2 vs 2 tag-team chess against humans and/or AI players — with an admin
console for managing users and games.

## Architecture

```
packages/
  engine/       Pure-TypeScript 4-player chess engine + AI (no dependencies).
                Shared by servers and browsers today; reusable as-is for future
                desktop (Electron/Tauri) and mobile (React Native/Capacitor) clients.

apps/
  server/       Combined backend (Express REST + Socket.IO); also
                serves the web app. Everything runs on one port: PORT (4000)
  player-web/   Single frontend (React + Vite), served by the backend
                /       -> player app (lobby, board, record, leaderboard)
                /admin  -> admin console (unlinked from the player UI;
                           requires an admin account)
```

- **server** — one process on `PORT`: the REST API (signup/login, profiles,
  game history, player search, leaderboard, admin stats and user management)
  and the realtime game side (groups, seating, AI seats, autopilot, moves over
  Socket.IO, persistence of results). Backed by MongoDB. See
  [Server layout](#server-layout) below.
- **player-web** — one frontend serving two surfaces. At `/`: lobby browser, group
  room (seat picking, AI seats, mode toggle), the live board (the same engine runs
  in the browser for instant legal-move highlights; the server revalidates every
  move), plus your record and the leaderboard. At `/admin` (deliberately not
  linked anywhere in the player UI): the admin console — stats, live games and
  groups, user management, full game history, and player search. Non-admin
  accounts that open `/admin` get an access-denied screen.

### Server layout

```
apps/server/src/
  server.ts        entry point: startup order, graceful shutdown
  app.ts           builds the Express app and mounts everything in order
  config/          every environment variable, read in one place
  lib/             logger, mailer, error types, small helpers
  db/              MongoDB connection; indexes and default admin at startup
  models/          data access, one file per collection
  views/           the shape of each record as sent to a client
  controllers/     request handlers, one file per area
  routes/          URL -> controller wiring
  middleware/      auth, per-request logging context, error handling
  services/        business logic: auth, stats, rtc, and live/ (groups, games)
  sockets/         realtime handlers, split into lobby / game / rtc
  web/             serves the web app: live reload in dev, built files otherwise
```

A request flows `routes -> middleware -> controller -> service -> model`, and
the controller answers with a `view`. Realtime events follow the same path
through `sockets/` instead of `routes/`.

**Logging** uses [pino](https://getpino.io). Every line is written through a
child logger that carries its context, so one line tells who did what, where:

| Where | Fields on every line |
|---|---|
| HTTP request | `reqId`, `ip`, and `userId` once signed in |
| Socket event | `socketId`, `ip`, `userId`, `event`, plus `gameId` / `lobbyId` |
| Game lifecycle | `gameId`, `lobbyId` |

`LOG_LEVEL` sets the detail (`debug` in development, `info` in production) and
`LOG_PRETTY=1` switches from JSON lines to readable ones. The request ID is
also returned in the `x-request-id` response header. Set `TRUST_PROXY` to the
number of proxies in front of the server so `ip` is the real client address
(defaults to 1 in production).

## Game rules

- 14×14 board with the 3×3 corners removed. Turns go clockwise: Red (bottom) →
  Blue (left) → Yellow (top) → Green (right).
- Standard piece movement; castling both sides; move by clicking or by
  dragging a piece. Pawns promote to a queen on the last square of their file:
  the opposite edge of the board in 4-player games, the 8th rank in 1 vs 1.
  (En passant is not implemented yet.)
- A player is **eliminated** by checkmate, stalemate, resignation — or by having
  their king captured (possible in 4-player chess, since two opponents move
  between your turns).
- **Conquest**: when an enemy's move eliminates a player (checkmate, stalemate,
  or king capture), the fallen player's remaining army **defects to the
  eliminator** (converted pieces count as already moved; the defeated king is
  removed). A resigned/abandoned army instead turns grey: immobile obstacles
  that can still be captured.
- **Points**: captures score material (P1 N3 B3 R5 Q9); eliminating a player
  scores 20 (10 for a stalemate); winning scores 20. If a game hits the move
  limit, the highest score among survivors wins. Final scores are stored per
  game and feed the leaderboard in the account app.
- **1 vs 1 (duel)**: classic chess — red vs yellow on a standard 8x8 board
  (the centre of the cross), same rules, points, powers and AI.
- **4 vs 4**: last player whose king survives wins.
- **Tag team 2 vs 2**: Red+Yellow vs Blue+Green. Partners can't capture each other.
  A team wins when **both** enemy kings are defeated; a team fights on even
  after losing one partner.
- **AI seats**: any seat can be filled by an AI (easy = greedy-random,
  medium = one-ply tactical evaluation). AI runs server-side; a game may be
  1 human + 3 AI, all humans, or anything in between.
- **Powers (optional, on by default when creating a game)**: every player gets
  five single-use powers. A power is set on your own turn, before you move,
  and does not cost the move. 😴 **Fainted** — secretly trap a square: the next
  enemy piece landing there falls asleep for one turn (immobile and
  uncapturable). 🛡 **Shield** — protect a square in your home rows: your
  piece standing on it cannot be captured. 💣 **Land Mine** — secretly mine a
  square: the next enemy piece landing there is destroyed (no points; a mined
  king counts as an elimination for the mine's owner). 🧱 **Fortress** —
  secretly make an empty square impassable. 🌀 **Teleport** — secretly trap a
  square: the next enemy piece landing there is moved to a random empty square.
  Effects last for 6 opponent moves, and your own board and the power's tile
  count down the moves left. Traps never affect their owner. **One power at a
  time**: while a wall or shield of yours stands, or a trap of yours is armed,
  you cannot set another; the next is free once that one has ended or gone
  off.
- **Powers are secret.** You see your own powers and, in a tag team, your
  partner's. Of your opponents' you see only:
  - their **shield**, without the count of moves it has left;
  - a **trap** once it has gone off: its icon marks the square and the move;
  - a **wall** once one of your moves has run into it. That move is refused
    ("A hidden wall stands on b5"), you pick another, and the wall stays on
    your board, without its count.

  Spectators see shields and sprung traps only. Using a power is never
  listed in the move list. This is enforced by the server, not the page:
  the state everyone is sent holds no wall, no trap and nobody's unused
  powers, each player is sent their own separately, and nothing at all is
  sent to the others when a power is set. Because enemy walls and traps are
  unknown to you, you may set a power on a square that already holds one of
  theirs; both then stand.
- **Autopilot (watch mode)**: a human can let the AI play their own seat —
  tick "AI plays my moves" when creating a group, or toggle it on your seat in
  the room / with the in-game Autopilot button. While it's on the board is
  view-only (manual moves are rejected); switch it off any time to take over.

## Run it

Runs on [Bun](https://bun.com) (≥ 1.1) with a local MongoDB server (macOS:
`brew install oven-sh/bun/bun mongodb-community && brew services start mongodb-community`).

```bash
bun install
bun run test        # engine unit tests

# development, with live reload:
bun run dev         # everything -> http://localhost:4000 (admin at /admin)

# production-style, serving the built web app:
bun run start       # everything -> http://localhost:4000
```

Both run the web app, the API and the realtime sockets on a single port, set
by `PORT` (default 4000). To use another one, change `PORT` — nothing else
refers to the number.

Environment lives in `env/`: `.env.sample` documents every variable. Copy it
to `env/.env.dev` and fill in your local values — the dev/serve scripts load
that file automatically via `bun --env-file`. `.env.dev` is gitignored, so it
never leaves your machine.

### Docker

One container runs the whole platform (API + realtime + built web app);
point it at any MongoDB with `MONGOHOST` / `MONGOPORT` / `MONGOUSER` /
`MONGOPASSWORD` (the variables hosting providers typically inject) or a full
`MONGODB_URI`:

```bash
docker build -t four-chess .
docker run -d -p 4000:4000 \
  -e MONGODB_URI="mongodb://host.docker.internal:27017" \
  -e JWT_SECRET=change-me \
  four-chess              # -> http://localhost:4000
```

`host.docker.internal` reaches a Mongo running on the host (macOS/Windows,
must be a replica set — see below);
for a managed database (e.g. MongoDB Atlas) just use its connection string.
No local Mongo at all? Run one in Docker first:

```bash
docker network create chess
docker run -d --name mongo --network chess -v mongo-data:/data/db mongo:8 --replSet rs0
docker exec mongo mongosh --quiet --eval "try { rs.status() } catch { rs.initiate() }"
docker run -d --name four-chess --network chess -p 4000:4000 \
  -e MONGODB_URI="mongodb://mongo:27017/?directConnection=true" \
  -e JWT_SECRET=change-me four-chess
```

MongoDB must run as a replica set (a single node is fine, as above): live
games and cross-pod broadcasts ride on change streams, which need one.

### Scaling out

Pods are stateless: every live game is a MongoDB document, moves apply with a
compare-and-swap on the move counter, and Socket.IO broadcasts fan out to all
instances through a capped collection (`@socket.io/mongo-adapter`). Run as
many replicas of the app image as you like behind one load balancer — any pod
serves any game, AI turns are picked up by whichever pod is alive, and games
survive deploys, crashes and restarts.

**Admins.** There is no built-in admin account. Register normally, then list
the account's email in `ADMIN_EMAILS` (comma-separated) and restart the
server: accounts named there are promoted at startup, and must sign in again
for it to take effect. Only accounts that already exist are promoted, because
sign-up does not verify email addresses. Databases created by earlier versions
contain `admin@chess.local` with a published password; it is removed
automatically at startup once another admin exists. Demoting, deactivating or
deleting an account takes effect at once: the server looks the account up on
every request and connection rather than trusting the role in the token.

End-to-end smoke scripts (servers must be running):

```bash
bun scripts/e2e-game.mjs   # signup -> group -> 3 AI -> play vs AI
bun scripts/e2e-win.mjs    # 4 humans -> three resign -> winner recorded
bun scripts/e2e-powers.mjs # powers stay secret: what opponents and spectators are sent
```

Environment variables: `JWT_SECRET`; MongoDB via `MONGOHOST` + `MONGOPORT` +
`MONGOUSER` + `MONGOPASSWORD` (takes precedence; `authSource=admin`) or
`MONGODB_URI` (default `mongodb://localhost:27017`); `FOUR_CHESS_DB_NAME` (default
`four-chess`); `PORT` (default 4000) — the single port for web app, API and
sockets, e.g. `docker run -e PORT=8080 -p 8080:8080 …`; and optionally
`VITE_API_URL` / `VITE_GAME_URL` to point the web app at a different server.
Voice/video calls use `STUN_URLS` (default: a public STUN server) and, for
players behind strict firewalls, a TURN relay via `TURN_URLS`,
`TURN_USERNAME` and `TURN_PASSWORD`. Browsers only allow the microphone and
camera on `https` (or `localhost`), so serve the deployed site over https. Coming from an older checkout that used SQLite? Run
`node scripts/migrate-sqlite-to-mongo.mjs` once (Node, for `node:sqlite`) to carry users and game
history over (password hashes are preserved).

## Roadmap

- **Desktop (all OS)**: wrap `player-web` with Electron or Tauri; the engine and
  socket protocol need no changes.
- **Mobile (Android/iOS)**: reuse `packages/engine` in React Native, or ship the
  web app via Capacitor.
- Gameplay: en passant, promotion choice UI, move clocks/timeouts, spectator
  polish, rematch votes, ratings & matchmaking.
- Ops: move lobbies/games to Redis for multi-instance game servers, refresh
  tokens, rate limiting, HTTPS.
