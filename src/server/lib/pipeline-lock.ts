import { getDb } from '../../db';
import * as schema from '../../db/schema';
import { eq, or, and } from 'drizzle-orm';

export const PIPELINE_GLOBAL_LOCK = 'ingestion_pipeline_execution';
export const LEGACY_CRON_LOCK = 'pipeline_cron';
export const DEFAULT_LOCK_LEASE_MS = 10 * 60 * 1000; // 10 minutes

export interface LockOptions {
  lockName?: string;
  ownerId: string;
  leaseMs?: number;
}

/**
 * Checks if the pipeline lock (or legacy alias) is currently held and unexpired.
 */
export async function isPipelineLocked(
  db: Awaited<ReturnType<typeof getDb>>,
  lockName: string = PIPELINE_GLOBAL_LOCK
): Promise<{ isLocked: boolean; ownerId?: string | null; expiresAt?: Date | null }> {
  const now = new Date();

  // Check both the specified lock and the legacy cron lock for full cross-compatibility
  const locks = await db
    .select()
    .from(schema.systemLocks)
    .where(
      or(
        eq(schema.systemLocks.lockName, lockName),
        eq(schema.systemLocks.lockName, LEGACY_CRON_LOCK)
      )
    );

  for (const lock of locks) {
    if (new Date(lock.expiresAt).getTime() > now.getTime()) {
      return {
        isLocked: true,
        ownerId: lock.ownerId,
        expiresAt: new Date(lock.expiresAt),
      };
    }
  }

  return { isLocked: false };
}

/**
 * Attempts to acquire the global pipeline execution guard.
 * Returns true if acquired; false if another run holds an active unexpired lease.
 * Automatically recovers from stale locks if the previous owner crashed.
 */
export async function acquirePipelineLock(
  db: Awaited<ReturnType<typeof getDb>>,
  options: LockOptions
): Promise<boolean> {
  const lockName = options.lockName || PIPELINE_GLOBAL_LOCK;
  const ownerId = options.ownerId;
  const leaseMs = options.leaseMs || DEFAULT_LOCK_LEASE_MS;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + leaseMs);

  // 1. Verify that neither the primary lock nor legacy cron lock is actively held
  const activeCheck = await isPipelineLocked(db, lockName);
  if (activeCheck.isLocked) {
    return false;
  }

  // 2. Fetch target lock entry if already exists (expired)
  const existing = await db
    .select()
    .from(schema.systemLocks)
    .where(eq(schema.systemLocks.lockName, lockName))
    .limit(1);

  if (existing.length > 0) {
    // Overwrite expired stale lock with new owner and extended lease
    await db
      .update(schema.systemLocks)
      .set({
        lockedAt: now,
        expiresAt,
        ownerId,
      })
      .where(eq(schema.systemLocks.lockName, lockName));
    return true;
  }

  // 3. If no lock row existed, insert new lock
  try {
    await db.insert(schema.systemLocks).values({
      lockName,
      lockedAt: now,
      expiresAt,
      ownerId,
    });
    return true;
  } catch {
    // Unique constraint violation or concurrency race condition
    return false;
  }
}

/**
 * Safely releases the global pipeline execution lock if held by this ownerId.
 */
export async function releasePipelineLock(
  db: Awaited<ReturnType<typeof getDb>>,
  options: LockOptions
): Promise<void> {
  const lockName = options.lockName || PIPELINE_GLOBAL_LOCK;
  const ownerId = options.ownerId;

  try {
    await db
      .delete(schema.systemLocks)
      .where(
        and(
          eq(schema.systemLocks.lockName, lockName),
          eq(schema.systemLocks.ownerId, ownerId)
        )
      );
  } catch (err) {
    console.warn(`[PipelineLock] Failed to release lock ${lockName} for ${ownerId}:`, err);
  }
}

/**
 * Executes an operation with guaranteed lock acquisition and safe release in finally.
 */
export async function withPipelineLock<T>(
  db: Awaited<ReturnType<typeof getDb>>,
  options: LockOptions,
  action: () => Promise<T>
): Promise<{ acquired: true; result: T } | { acquired: false; reason: string }> {
  const acquired = await acquirePipelineLock(db, options);
  if (!acquired) {
    return { acquired: false, reason: 'pipeline_already_running' };
  }

  try {
    const result = await action();
    return { acquired: true, result };
  } finally {
    await releasePipelineLock(db, options);
  }
}
