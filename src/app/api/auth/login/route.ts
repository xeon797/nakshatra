import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_COOKIE_NAME, verifyAdminSecret, getAdminSecret } from '../../../../lib/auth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { secret } = body;

    if (!secret || typeof secret !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Admin secret passphrase is required.' },
        { status: 400 }
      );
    }

    if (!verifyAdminSecret(secret)) {
      return NextResponse.json(
        { success: false, error: 'Invalid admin secret passphrase.' },
        { status: 401 }
      );
    }

    const response = NextResponse.json({ success: true, message: 'Authentication successful.' });

    // Set secure HTTP-only cookie
    response.cookies.set(ADMIN_COOKIE_NAME, getAdminSecret(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Authentication error.';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
