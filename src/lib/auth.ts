export const ADMIN_COOKIE_NAME = 'nakshatra_admin_token';

/**
 * Returns the configured admin secret from environment variables
 */
export function getAdminSecret(): string {
  return process.env.ADMIN_API_SECRET || 'nakshatra-secure-admin-secret-2026';
}

/**
 * Constant-time comparison function compatible with Edge runtime and Node.js
 */
export function timingSafeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  let mismatch = a.length === b.length ? 0 : 1;
  const maxLen = Math.max(a.length, b.length);
  for (let i = 0; i < maxLen; i++) {
    const charA = i < a.length ? a.charCodeAt(i) : 0;
    const charB = i < b.length ? b.charCodeAt(i) : 0;
    mismatch |= charA ^ charB;
  }
  return mismatch === 0;
}

/**
 * Verifies whether a provided secret matches the configured ADMIN_API_SECRET
 */
export function verifyAdminSecret(providedSecret: string | null | undefined): boolean {
  if (!providedSecret || typeof providedSecret !== 'string') {
    return false;
  }
  const expectedSecret = getAdminSecret();
  return timingSafeCompare(providedSecret.trim(), expectedSecret.trim());
}

/**
 * Returns the configured cron secret from environment variables
 */
export function getCronSecret(): string {
  return process.env.CRON_SECRET || 'dev-cron-secret-nakshatra';
}

/**
 * Verifies whether an incoming request is authorized with CRON_SECRET.
 * Supports:
 * 1. Authorization: Bearer <CRON_SECRET>
 * 2. ?secret=<CRON_SECRET> query parameter
 */
export function verifyCronSecret(req: Request): boolean {
  const expectedSecret = getCronSecret();
  if (!expectedSecret) return false;

  // 1. Check Bearer token header
  const authHeader = req.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (timingSafeCompare(token, expectedSecret.trim())) {
      return true;
    }
  }

  // 2. Check query parameter
  try {
    const url = new URL(req.url);
    const secretParam = url.searchParams.get('secret');
    if (secretParam && timingSafeCompare(secretParam.trim(), expectedSecret.trim())) {
      return true;
    }
  } catch {
    // If URL cannot be parsed
  }

  return false;
}

