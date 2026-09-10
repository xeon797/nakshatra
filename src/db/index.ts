import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import path from 'path';
import fs from 'fs';
import * as schema from './schema';
import { resetInitForTesting } from './init';

const { Pool } = pg;

export type AppDatabase = ReturnType<typeof drizzlePg<typeof schema>> | ReturnType<typeof drizzlePglite<typeof schema>>;

let cachedDb: AppDatabase | null = null;
let pgliteInstance: PGlite | null = null;

/**
 * Resolves the active data directory for embedded PGlite.
 * In development and non-test runtime, defaults to project-local `data/pglite`.
 * In automated test suites (Vitest), defaults to in-memory unless explicitly overridden via PGLITE_DATA_DIR.
 */
export function getPgliteDataDir(): string | undefined {
  if (process.env.PGLITE_DATA_DIR) {
    return process.env.PGLITE_DATA_DIR;
  }

  const isTest = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
  if (isTest) {
    return undefined;
  }

  return path.resolve(process.cwd(), 'data/pglite');
}

export async function getDb(): Promise<AppDatabase> {
  if (cachedDb) {
    return cachedDb;
  }

  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl && !databaseUrl.includes('placeholder')) {
    try {
      const isLocal =
        databaseUrl.includes('localhost') ||
        databaseUrl.includes('127.0.0.1') ||
        databaseUrl.includes('sslmode=disable');

      const pool = new Pool({
        connectionString: databaseUrl,
        max: process.env.DB_POOL_MAX ? parseInt(process.env.DB_POOL_MAX, 10) : 10,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 5000,
        ssl: isLocal ? false : { rejectUnauthorized: false },
      });
      cachedDb = drizzlePg(pool, { schema });
      return cachedDb;
    } catch (err) {
      console.warn('[DB] Failed to connect to external PostgreSQL, falling back to embedded PGlite:', err);
    }
  }

  // Embedded PostgreSQL (PGlite):
  // Uses persistent local filesystem directory in development/runtime; in-memory in test mode
  if (!pgliteInstance) {
    const dataDir = getPgliteDataDir();
    if (dataDir) {
      fs.mkdirSync(dataDir, { recursive: true });
      pgliteInstance = new PGlite(dataDir);
    } else {
      pgliteInstance = new PGlite();
    }
  }

  cachedDb = drizzlePglite(pgliteInstance, { schema });
  return cachedDb;
}

export async function closeDb(): Promise<void> {
  if (pgliteInstance) {
    try {
      await pgliteInstance.close();
    } catch {
      // Ignore close errors
    }
    pgliteInstance = null;
  }
  cachedDb = null;
  resetInitForTesting();
}

export function resetDbForTesting(): void {
  if (pgliteInstance) {
    try {
      pgliteInstance.close();
    } catch {
      // Ignore close errors
    }
  }
  cachedDb = null;
  pgliteInstance = null;
  resetInitForTesting();
}

export { schema };
