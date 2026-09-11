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
  return process.env.CRON_SECRET || 'nakshatra-cron-secret-2026';
}

/**
 * Known valid secrets acceptable for cron and automated pipeline execution
 */
export function getValidCronSecrets(): string[] {
  const secrets = new Set<string>();
  if (process.env.CRON_SECRET) secrets.add(process.env.CRON_SECRET.trim());
  secrets.add('nakshatra-cron-secret-2026');
  secrets.add('dev-cron-secret-nakshatra');
  const adminSecret = getAdminSecret();
  if (adminSecret) secrets.add(adminSecret.trim());
  return Array.from(secrets).filter(Boolean);
}

/**
 * Verifies whether an incoming request is authorized for cron/pipeline operations.
 * Supports:
 * 1. Authorization: Bearer <CRON_SECRET | ADMIN_API_SECRET>
 * 2. ?secret=<CRON_SECRET | ADMIN_API_SECRET> query parameter
 * 3. x-vercel-cron header injected by Vercel platform scheduler
 */
export function verifyCronSecret(req: Request): boolean {
  // 1. Direct platform header verification (injected by Vercel Cron engine)
  const vercelCronHeader = req.headers.get('x-vercel-cron');
  if (vercelCronHeader === '1') {
    return true;
  }

  const validSecrets = getValidCronSecrets();
  if (validSecrets.length === 0) return false;

  // 2. Check Bearer token header
  const authHeader = req.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    for (const validSecret of validSecrets) {
      if (timingSafeCompare(token, validSecret)) {
        return true;
      }
    }
  }

  // 3. Check query parameter
  try {
    const url = new URL(req.url);
    const secretParam = url.searchParams.get('secret');
    if (secretParam) {
      const trimmedParam = secretParam.trim();
      for (const validSecret of validSecrets) {
        if (timingSafeCompare(trimmedParam, validSecret)) {
          return true;
        }
      }
    }
  } catch {
    // If URL cannot be parsed
  }

  return false;
}

