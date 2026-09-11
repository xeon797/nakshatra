/**
 * Retry Policy & Failure Classification for Autonomous News Pipeline
 * Enforces controlled failure lifecycle, prevents infinite retry loops,
 * and protects external API quotas.
 */

export const DEFAULT_MAX_RETRIES = 3;
export const INITIAL_BACKOFF_MS = 60 * 1000; // 1 minute
export const MAX_BACKOFF_MS = 15 * 60 * 1000; // 15 minutes

export type FailureStage = 'ingestion' | 'clustering' | 'research' | 'writing' | 'validation' | 'database';

export interface ErrorClassification {
  isRetryable: boolean;
  isRateLimit: boolean;
  isBudgetExceeded?: boolean;
  reason: string;
}

/**
 * Classifies an error into retryable vs non-retryable categories,
 * detecting external rate limits / quota exhaustion.
 */
export function classifyError(err: unknown): ErrorClassification {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  // 0. Explicit Gemini request budget halt (Not a failure, cleanly stops the batch)
  const isBudgetExceeded =
    lower.includes('budget') ||
    lower.includes('geminibudgetexceedederror') ||
    (err as { name?: string })?.name === 'GeminiBudgetExceededError';

  if (isBudgetExceeded) {
    return {
      isRetryable: false,
      isRateLimit: false,
      isBudgetExceeded: true,
      reason: message,
    };
  }

  // 1. Rate-limiting / Quota Exhaustion (Retryable after delay/cooldown, but halt current batch)
  const isRateLimit =
    lower.includes('429') ||
    lower.includes('quota') ||
    lower.includes('resource_exhausted') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('exceeded quota') ||
    lower.includes('credit limit');

  // 2. Non-Retryable Failures: permanent data/validation invariants that will never succeed on retry
  const isNonRetryable =
    lower.includes('grounding invariant violation') ||
    lower.includes('has no linked source articles') ||
    (lower.includes('story with id') && lower.includes('not found')) ||
    lower.includes('invalid claim index') ||
    lower.includes('invalid argument') ||
    lower.includes('validation error') ||
    lower.includes('400 bad request') ||
    lower.includes('permanently malformed') ||
    lower.includes('schema validation failed') ||
    lower.includes('zoderror');

  if (isNonRetryable) {
    return {
      isRetryable: false,
      isRateLimit: false,
      reason: message,
    };
  }

  // 3. Transient Network / Server Outages (Retryable)
  const isNetworkTransient =
    lower.includes('econnreset') ||
    lower.includes('etimedout') ||
    lower.includes('enotfound') ||
    lower.includes('fetch failed') ||
    lower.includes('network error') ||
    lower.includes('socket hang up') ||
    lower.includes('502') ||
    lower.includes('503') ||
    lower.includes('504') ||
    lower.includes('service unavailable') ||
    lower.includes('gateway timeout') ||
    lower.includes('overloaded') ||
    lower.includes('connection refused');

  if (isRateLimit || isNetworkTransient) {
    return {
      isRetryable: true,
      isRateLimit,
      reason: message,
    };
  }

  // Default: Unknown unexpected runtime errors allow limited retries up to maxRetries
  return {
    isRetryable: true,
    isRateLimit: false,
    reason: message,
  };
}

/**
 * Calculates exponential backoff duration in milliseconds for a retry attempt.
 * Attempt 1: 1 min, Attempt 2: 2 min, Attempt 3: 4 min (capped at MAX_BACKOFF_MS).
 */
export function getRetryBackoffMs(retryCount: number): number {
  if (retryCount <= 0) return 0;
  const backoff = INITIAL_BACKOFF_MS * Math.pow(2, retryCount - 1);
  return Math.min(backoff, MAX_BACKOFF_MS);
}

/**
 * Evaluates whether a story is currently eligible to be retried by the autonomous pipeline.
 */
export function isStoryEligibleForRetry(
  story: {
    editorialStatus: string;
    processingStatus?: string | null;
    retryCount?: number | null;
    lastAttemptedAt?: Date | string | null;
  },
  maxRetries: number = getMaxRetriesFromEnv(),
  staleThresholdMs?: number
): boolean {
  // Only auto_approved stories can be automatically synthesized
  if (story.editorialStatus !== 'auto_approved') {
    return false;
  }

  // Completed stories must never be re-processed
  if (story.processingStatus === 'completed') {
    return false;
  }

  // Stories currently being processed by another worker are locked
  // UNLESS a stale lease is provided and expired
  if (story.processingStatus === 'processing') {
    if (staleThresholdMs && story.lastAttemptedAt) {
      const elapsed = Date.now() - new Date(story.lastAttemptedAt).getTime();
      if (elapsed >= staleThresholdMs) {
        return true; // Stale lease expired
      }
    }
    return false;
  }

  const retries = story.retryCount || 0;
  if (retries >= maxRetries) {
    return false;
  }

  // Enforce backoff if story has previously failed
  if (story.lastAttemptedAt && retries > 0 && story.processingStatus === 'failed') {
    const lastAttemptTime = new Date(story.lastAttemptedAt).getTime();
    const elapsed = Date.now() - lastAttemptTime;
    const requiredBackoff = getRetryBackoffMs(retries);

    if (elapsed < requiredBackoff) {
      return false;
    }
  }

  return true;
}

export function getMaxRetriesFromEnv(): number {
  if (process.env.MAX_STORY_RETRIES) {
    const parsed = parseInt(process.env.MAX_STORY_RETRIES, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return DEFAULT_MAX_RETRIES;
}
