import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { db } from './index';
import { Database } from 'bun:sqlite';

// Get the underlying SQLite instance
const sqlite = (db as any).session.client as Database;

migrate(db, { migrationsFolder: './drizzle' });

console.log('Database migrations completed successfully!');