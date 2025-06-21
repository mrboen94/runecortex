import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Database } from 'bun:sqlite';
import * as schema from './schema';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';

const dbPath = process.env.DATABASE_PATH || './data/runecortex.db';

// Ensure data directory exists
await mkdir(dirname(dbPath), { recursive: true }).catch(() => {});

const sqlite = new Database(dbPath);
export const db = drizzle(sqlite, { schema });

// Enable foreign keys
sqlite.exec('PRAGMA foreign_keys = ON;');

// Optimize for performance
sqlite.exec('PRAGMA journal_mode = WAL;');
sqlite.exec('PRAGMA synchronous = NORMAL;');
sqlite.exec('PRAGMA cache_size = -32000;'); // 32MB cache

export { schema };