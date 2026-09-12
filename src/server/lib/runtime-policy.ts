/**
 * Runtime limits for the production cron route.
 *
 * The HTTP caller waits 55 seconds and Vercel terminates the function at 60
 * seconds. The worker therefore stops at 40 seconds and reserves the final
 * eight seconds of its own deadline for queue and lock cleanup.
 */
export const PIPELINE_FUNCTION_MAX_DURATION_SECONDS = 60;
export const PIPELINE_HTTP_TIMEOUT_MS = 55_000;
export const PIPELINE_WORKER_DEADLINE_MS = 40_000;
export const PIPELINE_GEMINI_TIMEOUT_MS = 15_000;
export const PIPELINE_SHUTDOWN_HEADROOM_MS = 8_000;
export const PIPELINE_RESEARCH_FETCH_TIMEOUT_MS = 4_000;
export const PIPELINE_LOCK_LEASE_MS = 50_000;
export const PIPELINE_STORY_LEASE_MS = 60_000;
export const PIPELINE_TRANSIENT_COOLDOWN_MS = 60_000;
export const PIPELINE_QUOTA_COOLDOWN_MS = 60 * 60_000;

export function assertRuntimePolicy(): void {
  if (PIPELINE_GEMINI_TIMEOUT_MS + PIPELINE_SHUTDOWN_HEADROOM_MS >= PIPELINE_WORKER_DEADLINE_MS) {
    throw new Error('Gemini timeout and shutdown headroom must fit inside the worker deadline.');
  }
  if (PIPELINE_WORKER_DEADLINE_MS >= PIPELINE_HTTP_TIMEOUT_MS) {
    throw new Error('Worker deadline must finish before the HTTP client timeout.');
  }
  if (PIPELINE_HTTP_TIMEOUT_MS >= PIPELINE_FUNCTION_MAX_DURATION_SECONDS * 1000) {
    throw new Error('HTTP client timeout must finish before the Vercel function timeout.');
  }
  if (PIPELINE_LOCK_LEASE_MS >= PIPELINE_FUNCTION_MAX_DURATION_SECONDS * 1000) {
    throw new Error('Pipeline lock lease must expire before the Vercel function timeout.');
  }
}
