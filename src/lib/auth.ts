export const ADMIN_COOKIE_NAME = 'nakshatra_admin_token';

/**
 * Returns the configured admin secret from environment variables
 */
export function getAdminSecret(): string {
  return process.env.ADMIN_API_SECRET?.trim() || '';
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
  return expectedSecret.length > 0 && timingSafeCompare(providedSecret.trim(), expectedSecret);
}

/**
 * Returns the configured cron secret from environment variables
 */
export function getCronSecret(): string {
  return process.env.CRON_SECRET?.trim() || '';
}

/**
 * Verifies whether an incoming request is authorized for cron/pipeline operations.
 * The only accepted credential path is Authorization: Bearer <CRON_SECRET>.
 */
export function verifyCronSecret(req: Request): boolean {
  const expectedSecret = getCronSecret();
  if (!expectedSecret) return false;

  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;

  const token = authHeader.slice(7).trim();
  return token.length > 0 && timingSafeCompare(token, expectedSecret);
}

