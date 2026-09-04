import { describe, it, expect } from 'vitest';
import { verifyAdminSecret, timingSafeCompare, getAdminSecret, ADMIN_COOKIE_NAME } from '../auth';
import { middleware } from '../../middleware';
import { NextRequest } from 'next/server';

describe('Security Layer: Authentication & Timing-Safe Verification', () => {
  const currentSecret = getAdminSecret();

  describe('Secret Verification', () => {
    it('approves exact matching secret', () => {
      expect(verifyAdminSecret(currentSecret)).toBe(true);
    });

    it('rejects incorrect, forged, or empty secrets', () => {
      expect(verifyAdminSecret('wrong-secret-token')).toBe(false);
      expect(verifyAdminSecret('')).toBe(false);
      expect(verifyAdminSecret(null)).toBe(false);
      expect(verifyAdminSecret(undefined)).toBe(false);
    });

    it('performs timingSafeCompare reliably across variable length inputs', () => {
      expect(timingSafeCompare('short', 'longer-string-comparison')).toBe(false);
      expect(timingSafeCompare('exact-match', 'exact-match')).toBe(true);
    });
  });

  describe('Next.js Security Middleware', () => {
    it('rejects unauthorized API calls to /api/pipeline/run with 401', () => {
      const req = new NextRequest('http://localhost:3000/api/pipeline/run', {
        method: 'POST',
      });
      const response = middleware(req);
      expect(response.status).toBe(401);
    });

    it('permits authorized API calls to /api/pipeline/run with valid Bearer token', () => {
      const req = new NextRequest('http://localhost:3000/api/pipeline/run', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${currentSecret}`,
        },
      });
      const response = middleware(req);
      expect(response.status).toBe(200); // NextResponse.next() defaults to status 200
    });

    it('redirects unauthenticated browser requests from /admin/newsroom to /admin/login', () => {
      const req = new NextRequest('http://localhost:3000/admin/newsroom', {
        method: 'GET',
      });
      const response = middleware(req);
      expect(response.status).toBe(307); // NextResponse.redirect defaults to 307
      expect(response.headers.get('location')).toContain('/admin/login?redirect=%2Fadmin%2Fnewsroom');
    });

    it('permits authenticated browser access when valid session cookie is present', () => {
      const req = new NextRequest('http://localhost:3000/admin/newsroom', {
        method: 'GET',
        headers: {
          cookie: `${ADMIN_COOKIE_NAME}=${currentSecret}`,
        },
      });
      const response = middleware(req);
      expect(response.status).toBe(200);
    });
  });
});
