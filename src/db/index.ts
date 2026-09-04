import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import * as schema from './schema';
import { resetInitForTesting } from './init';

const { Pool } = pg;

type AppDatabase = ReturnType<typeof drizzlePg<typeof schema>> | ReturnType<typeof drizzlePglite<typeof schema>>;

let cachedDb: AppDatabase | null = null;
let pgliteInstance: PGlite | null = null;

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

  // In-process embedded PostgreSQL (PGlite) for local development / test isolation
  if (!pgliteInstance) {
    pgliteInstance = new PGlite();
  }
  cachedDb = drizzlePglite(pgliteInstance, { schema });
  return cachedDb;
}

export function resetDbForTesting(): void {
  cachedDb = null;
  pgliteInstance = null;
  resetInitForTesting();
}

export { schema };
