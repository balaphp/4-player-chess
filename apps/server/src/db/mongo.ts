import { type Db, MongoClient, ObjectId } from 'mongodb';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';

export { ObjectId };
export type { Db };

const log = logger.child({ component: 'mongo' });

let client: MongoClient | null = null;
let database: Db | null = null;

// one MongoDB database: accounts, game history, and the live lobbies/games
// shared by every server instance
export async function connectMongo(): Promise<Db> {
  if (database) return database;
  client = new MongoClient(config.mongo.uri);
  await client.connect();
  database = client.db(config.mongo.dbName);
  log.info({ db: config.mongo.dbName }, 'connected');
  return database;
}

export function db(): Db {
  if (!database) throw new Error('MongoDB is not connected yet');
  return database;
}

export async function closeMongo(): Promise<void> {
  await client?.close();
  client = null;
  database = null;
}
