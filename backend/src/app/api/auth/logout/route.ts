import { NextResponse } from 'next/server';
import { apiSuccess } from '@/lib/response';

export async function POST() {
  const response = apiSuccess({
    message: 'Logged out successfully',
  });

  // Clear session cookie
  response.cookies.set('session', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: new Date(0),
    path: '/',
  });

  return response;
}
