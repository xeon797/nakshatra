import { describe, it, expect } from 'vitest';
import { parseEnv, validateProductionEnv } from '../../lib/env';
import { timingSafeCompare, verifyCronSecret, getCronSecret } from '../../lib/auth';

describe('Environment Variable Validator & Security Auditing', () => {
  it('parses valid environment variables with sensible defaults', () => {
    const parsed = parseEnv({
      NODE_ENV: 'test',
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    });

    expect(parsed.ADMIN_API_SECRET).toBe('dev-secret-nakshatra-key');
    expect(parsed.CRON_SECRET).toBe('dev-cron-secret-nakshatra');
    expect(parsed.NODE_ENV).toBe('test');
    expect(parsed.NEXT_PUBLIC_APP_URL).toBe('http://localhost:3000');
  });

  it('detects missing production environment requirements', () => {
    const prodCheck = validateProductionEnv({
      NODE_ENV: 'production',
      GEMINI_API_KEY: '',
      DATABASE_URL: 'placeholder',
    });

    expect(prodCheck.valid).toBe(false);
    expect(prodCheck.missing).toContain('GEMINI_API_KEY');
    expect(prodCheck.missing).toContain('DATABASE_URL');
  });

  it('confirms valid production environment when all critical keys are provided', () => {
    const prodCheck = validateProductionEnv({
      NODE_ENV: 'production',
      GEMINI_API_KEY: 'test-real-gemini-key',
      DATABASE_URL: 'postgresql://postgres:secret@localhost:5432/nakshatra',
      ADMIN_API_SECRET: 'production-admin-secret-2026',
      CRON_SECRET: 'production-cron-secret-2026',
    });

    expect(prodCheck.valid).toBe(true);
    expect(prodCheck.missing.length).toBe(0);
  });

  it('never discloses secret values in validation errors', () => {
    try {
      parseEnv({
        NODE_ENV: 'invalid_environment' as any,
        GEMINI_API_KEY: 'super-sensitive-secret-token-12345',
      });
      expect.unreachable('Should have thrown validation error');
    } catch (err: any) {
      expect(err.message).not.toContain('super-sensitive-secret-token-12345');
      expect(err.message).toContain('Environment validation failed');
    }
  });

  it('validates and accepts valid RESEND, TAVILY, and JINA API keys with prefixes', () => {
    const parsed = parseEnv({
      NODE_ENV: 'test',
      RESEND_API_KEY: 're_mock_123456789',
      TAVILY_API_KEY: 'tvly-mock-123456789',
      JINA_API_KEY: 'jina_mock_123456789',
    });

    expect(parsed.RESEND_API_KEY).toBe('re_mock_123456789');
    expect(parsed.TAVILY_API_KEY).toBe('tvly-mock-123456789');
    expect(parsed.JINA_API_KEY).toBe('jina_mock_123456789');
  });

  it('rejects improperly formatted external service keys without leaking secret values', () => {
    const invalidSecret = 'invalid_secret_resend_99999';
    try {
      parseEnv({
        NODE_ENV: 'test',
        RESEND_API_KEY: invalidSecret,
      });
      expect.unreachable('Should have rejected invalid RESEND key');
    } catch (err: any) {
      expect(err.message).not.toContain(invalidSecret);
      expect(err.message).toContain("Must start with 're_'");
    }

    const invalidTavily = 'wrong_tavily_key_11111';
    try {
      parseEnv({
        NODE_ENV: 'test',
        TAVILY_API_KEY: invalidTavily,
      });
      expect.unreachable('Should have rejected invalid TAVILY key');
    } catch (err: any) {
      expect(err.message).not.toContain(invalidTavily);
      expect(err.message).toContain("Must start with 'tvly-'");
    }

    const invalidJina = 'wrong_jina_key_22222';
    try {
      parseEnv({
        NODE_ENV: 'test',
        JINA_API_KEY: invalidJina,
      });
      expect.unreachable('Should have rejected invalid JINA key');
    } catch (err: any) {
      expect(err.message).not.toContain(invalidJina);
      expect(err.message).toContain("Must start with 'jina_'");
    }
  });

  describe('Constant-time timingSafeCompare security', () => {
    it('returns true for identical strings', () => {
      expect(timingSafeCompare('secret-token-123', 'secret-token-123')).toBe(true);
    });

    it('returns false for mismatched strings or lengths', () => {
      expect(timingSafeCompare('secret-token-123', 'secret-token-456')).toBe(false);
      expect(timingSafeCompare('short', 'much-longer-string')).toBe(false);
    });

    it('handles non-string inputs safely without throwing', () => {
      expect(timingSafeCompare(null as any, 'string')).toBe(false);
      expect(timingSafeCompare('string', undefined as any)).toBe(false);
    });
  });

  describe('verifyCronSecret verification logic', () => {
    const secret = 'production-cron-secret-val-2026';

    it('verifies valid Bearer authorization header', () => {
      process.env.CRON_SECRET = secret;
      const req = new Request('http://localhost:3000/api/cron/pipeline', {
        headers: { authorization: `Bearer ${secret}` },
      });
      expect(verifyCronSecret(req)).toBe(true);
    });

    it('verifies valid ?secret= query parameter', () => {
      process.env.CRON_SECRET = secret;
      const req = new Request(`http://localhost:3000/api/cron/pipeline?secret=${secret}`);
      expect(verifyCronSecret(req)).toBe(true);
    });

    it('rejects incorrect secret in both header and query', () => {
      process.env.CRON_SECRET = secret;
      const reqHeader = new Request('http://localhost:3000/api/cron/pipeline', {
        headers: { authorization: 'Bearer wrong-secret' },
      });
      expect(verifyCronSecret(reqHeader)).toBe(false);

      const reqQuery = new Request('http://localhost:3000/api/cron/pipeline?secret=wrong-secret');
      expect(verifyCronSecret(reqQuery)).toBe(false);
    });
  });
});
