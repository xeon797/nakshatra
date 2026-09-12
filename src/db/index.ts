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
let activePool: pg.Pool | null = null;

export function getActivePool(): pg.Pool | null {
  return activePool;
}

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

  // On Vercel / AWS Lambda / Serverless, process.cwd() is read-only (/var/task).
  // Use /tmp which is the only writable directory in serverless environments.
  const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT);
  if (isServerless) {
    return path.resolve('/tmp', 'nakshatra-pglite');
  }

  return path.resolve(process.cwd(), 'data/pglite');
}

export async function getDb(): Promise<AppDatabase> {
  const requiresPostgres = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
  const configuredUrl = process.env.DATABASE_URL?.trim();
  if (requiresPostgres && (!configuredUrl || configuredUrl.includes('placeholder'))) {
    throw new Error('[DB] DATABASE_URL is required in production. Embedded PGlite fallback is disabled.');
  }
  if (cachedDb) {
    return cachedDb;
  }

  const isTest = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
  const databaseUrl = isTest && !requiresPostgres && !process.env.TEST_WITH_REAL_DB ? undefined : configuredUrl;

  if (databaseUrl && !databaseUrl.includes('placeholder')) {
    try {
      const isLocal =
        databaseUrl.includes('localhost') ||
        databaseUrl.includes('127.0.0.1') ||
        databaseUrl.includes('sslmode=disable');

      if (!activePool) {
        activePool = new Pool({
          connectionString: databaseUrl,
          max: process.env.DB_POOL_MAX ? parseInt(process.env.DB_POOL_MAX, 10) : 10,
          idleTimeoutMillis: 10000,
          connectionTimeoutMillis: 5000,
          statement_timeout: 10000,
          query_timeout: 10000,
          ssl: isLocal ? false : { rejectUnauthorized: false },
        });
      }
      cachedDb = drizzlePg(activePool, { schema });
      return cachedDb;
    } catch (err) {
      if (requiresPostgres) {
        throw new Error('[DB] PostgreSQL configuration failed. Embedded PGlite fallback is disabled.', { cause: err });
      }
      console.warn('[DB] Failed to connect to external PostgreSQL, falling back to embedded PGlite:', err);
    }
  }

  // Embedded PostgreSQL (PGlite):
  // Uses persistent local filesystem directory in development/runtime; in-memory in test mode or if filesystem is read-only
  if (!pgliteInstance) {
    const dataDir = getPgliteDataDir();
    if (dataDir) {
      try {
        fs.mkdirSync(dataDir, { recursive: true });
        pgliteInstance = new PGlite(dataDir);
      } catch (fsErr) {
        console.warn(`[DB] Could not initialize PGlite directory at ${dataDir}, falling back to in-memory:`, fsErr);
        pgliteInstance = new PGlite();
      }
    } else {
      pgliteInstance = new PGlite();
    }
  }

  cachedDb = drizzlePglite(pgliteInstance, { schema });
  return cachedDb;
}

export async function closeDb(): Promise<void> {
  if (activePool) {
    try {
      await activePool.end();
    } catch {
      // Ignore close errors
    }
    activePool = null;
  }
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
  if (activePool) {
    activePool.end().catch(() => {});
    activePool = null;
  }
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
