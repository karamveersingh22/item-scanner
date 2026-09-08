import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { verifyPassword, signCompanyToken } from '@/lib/auth';
import { apiError, apiSuccess } from '@/lib/response';
import { toSafeCompany } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password } = body;

    if (!username || typeof username !== 'string' || !username.trim()) {
      return apiError('Username is required', 400);
    }

    if (!password || typeof password !== 'string') {
      return apiError('Password is required', 400);
    }

    const company = await db.findCompanyByUsername(username);
    if (!company) {
      // Use generic error to avoid username enumeration attacks
      return apiError('Invalid username or password', 401);
    }

    // Check account status
    if (company.status === 'DISABLED') {
      return apiError('Company account has been disabled. Please contact support.', 403);
    }

    // Verify password hash
    const isValid = await verifyPassword(password, company.password_hash);
    if (!isValid) {
      return apiError('Invalid username or password', 401);
    }

    // Generate signed JWT session token
    const token = await signCompanyToken(company);
    const safeCompany = toSafeCompany(company);

    const response = apiSuccess({
      token,
      company: safeCompany,
    });

    // Set secure session cookie (for Company Management Web Panel)
    response.cookies.set('session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('Login error:', error);
    return apiError('An error occurred during authentication', 500);
  }
}
