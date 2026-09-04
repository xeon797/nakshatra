import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_COOKIE_NAME, verifyAdminSecret } from './lib/auth';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow login page and public auth endpoints
  if (pathname === '/admin/login' || pathname.startsWith('/api/auth/')) {
    return NextResponse.next();
  }

  // Determine if this is a protected admin route or sensitive API mutation route
  const isProtectedAdminPage = pathname.startsWith('/admin');
  const isProtectedApiRoute =
    pathname.startsWith('/api/admin') ||
    pathname.startsWith('/api/pipeline') ||
    pathname.startsWith('/api/articles/') && (pathname.endsWith('/approve') || pathname.endsWith('/reject'));

  if (!isProtectedAdminPage && !isProtectedApiRoute) {
    return NextResponse.next();
  }

  // 1. Check Authorization header (Bearer token) or direct ADMIN_API_SECRET header
  const authHeader = request.headers.get('authorization');
  const directHeader =
    request.headers.get('admin_api_secret') ||
    request.headers.get('x-admin-secret') ||
    request.headers.get('admin-api-secret');

  let tokenFromHeader: string | null = directHeader;
  if (!tokenFromHeader && authHeader && authHeader.startsWith('Bearer ')) {
    tokenFromHeader = authHeader.substring(7).trim();
  }

  // 2. Check Admin Session Cookie
  const tokenFromCookie = request.cookies.get(ADMIN_COOKIE_NAME)?.value || null;

  const candidateToken = tokenFromHeader || tokenFromCookie;
  const isAuthenticated = verifyAdminSecret(candidateToken);

  if (!isAuthenticated) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized: Invalid or missing admin credentials. Provide a valid ADMIN_API_SECRET header or login.',
        },
        { status: 401 }
      );
    }

    // Redirect unauthenticated browser requests to login
    const loginUrl = new URL('/admin/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*', '/api/pipeline/:path*', '/api/articles/:path*'],
};
