// One-time migration: copy users and games from the old SQLite file into MongoDB.
// Password hashes are preserved, so existing accounts keep working.
// Safe to re-run: users are matched by email, games by id.
import { DatabaseSync } from 'node:sqlite';
import { MongoClient, ObjectId } from 'mongodb';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sqlitePath = process.env.FOUR_CHESS_DB ?? path.join(ROOT, 'data', 'four-chess.db');
if (!fs.existsSync(sqlitePath)) {
  console.log('No SQLite database found at', sqlitePath, '- nothing to migrate.');
  process.exit(0);
}

const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
const client = new MongoClient(process.env.MONGODB_URI ?? 'mongodb://localhost:27017');
await client.connect();
const db = client.db(process.env.FOUR_CHESS_DB_NAME ?? 'four-chess');
const users = db.collection('users');
const games = db.collection('games');

// ---- users ----
const idMap = new Map(); // old numeric id -> ObjectId hex string
let usersMigrated = 0;
for (const u of sqlite.prepare('SELECT * FROM users').all()) {
  const existing = await users.findOne({ email: u.email });
  if (existing) {
    idMap.set(u.id, existing._id.toHexString());
    continue;
  }
  const _id = new ObjectId();
  await users.insertOne({
    _id,
    email: u.email,
    username: u.username,
    passwordHash: u.password_hash,
    role: u.role === 'admin' ? 'admin' : 'user',
    active: !!u.active,
    createdAt: new Date(u.created_at + 'Z'),
  });
  idMap.set(u.id, _id.toHexString());
  usersMigrated++;
}

// ---- games ----
let gamesMigrated = 0;
for (const g of sqlite.prepare('SELECT * FROM games').all()) {
  if (await games.findOne({ _id: g.id })) continue;
  const players = JSON.parse(g.players_json).map((p) => ({
    color: p.color,
    ...(p.userId !== undefined ? { userId: idMap.get(p.userId) } : {}),
    username: p.username,
    ai: !!p.ai,
  }));
  await games.insertOne({
    _id: g.id,
    mode: g.mode,
    status: g.status,
    groupName: g.group_name,
    players,
    winners: g.winners_json ? JSON.parse(g.winners_json) : null,
    scores: g.scores_json ? JSON.parse(g.scores_json) : null,
    movesCount: g.moves_count,
    startedAt: new Date(g.started_at + 'Z'),
    endedAt: g.ended_at ? new Date(g.ended_at + 'Z') : null,
  });
  gamesMigrated++;
}

console.log(`Migrated ${usersMigrated} users and ${gamesMigrated} games to MongoDB.`);
console.log(`Totals in MongoDB now: ${await users.countDocuments()} users, ${await games.countDocuments()} games.`);
await client.close();
process.exit(0);
