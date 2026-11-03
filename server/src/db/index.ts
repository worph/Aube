import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import type { Database as SqliteDatabase } from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema.js'

// Ported from Newsdesk server/src/db/index.ts. The drift guards of Newsdesk's migrations.ts are
// not ported: Aube's migrations are append-only from the first commit.

export type Db = BetterSQLite3Database<typeof schema> & { $client: SqliteDatabase }

export function openDb(file: string): Db {
  if (file !== ':memory:') mkdirSync(dirname(resolve(file)), { recursive: true })
  const sqlite = new Database(file)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
  const db = drizzle(sqlite, { schema }) as Db
  migrate(db, { migrationsFolder: migrationsFolder() })
  return db
}

/** `server/drizzle`, from both `src/db` (tsx, tests) and `dist/db` (built). */
function migrationsFolder(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle')
}

export { schema }
