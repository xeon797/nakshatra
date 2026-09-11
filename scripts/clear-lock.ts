import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { getDb, closeDb, schema } from '../src/db';
import { eq } from 'drizzle-orm';
import { PIPELINE_GLOBAL_LOCK, LEGACY_CRON_LOCK } from '../src/server/lib/pipeline-lock';

async function clearLocks() {
  const db = await getDb();
  try {
    await db
      .delete(schema.systemLocks)
      .where(eq(schema.systemLocks.lockName, PIPELINE_GLOBAL_LOCK));
    await db
      .delete(schema.systemLocks)
      .where(eq(schema.systemLocks.lockName, LEGACY_CRON_LOCK));
    console.log('✓ System locks successfully cleared.');
  } finally {
    await closeDb();
  }
}

clearLocks().catch((err) => {
  console.error('Failed to clear locks:', err);
  process.exit(1);
});
