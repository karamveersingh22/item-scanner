import { NextRequest } from 'next/server';
import { authenticateRequest, hashPassword, verifyPassword, signCompanyToken } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiError, apiSuccess } from '@/lib/response';
import { toSafeCompany } from '@/lib/types';

export async function PUT(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth.authenticated) {
      return apiError(auth.error, auth.status);
    }

    const body = await request.json();
    const { current_password, new_username, new_password } = body;

    // 1. Mandatory verification of current password
    if (!current_password || typeof current_password !== 'string') {
      return apiError('Current password is required to change credentials', 400);
    }

    const isCurrentValid = await verifyPassword(current_password, auth.company.password_hash);
    if (!isCurrentValid) {
      return apiError('Current password is incorrect', 401);
    }

    if (!new_username && !new_password) {
      return apiError('Either new_username or new_password must be provided', 400);
    }

    const updates: { username?: string; password_hash?: string } = {};

    // 2. Process username change if provided
    if (new_username !== undefined) {
      if (typeof new_username !== 'string' || !new_username.trim()) {
        return apiError('New username cannot be empty', 400);
      }
      const trimmed = new_username.trim();
      if (trimmed !== auth.company.username) {
        updates.username = trimmed;
      }
    }

    // 3. Process password change if provided
    if (new_password !== undefined) {
      if (typeof new_password !== 'string' || new_password.length < 6) {
        return apiError('New password must be at least 6 characters long', 400);
      }
      updates.password_hash = await hashPassword(new_password);
    }

    // 4. Commit updates to database
    const updated = await db.updateCompanyCredentials(auth.company.id, updates);
    if (!updated) {
      return apiError('Failed to update credentials', 500);
    }

    // 5. Issue new session token reflecting the new credentials
    const newToken = await signCompanyToken(updated);
    const safeCompany = toSafeCompany(updated);

    const response = apiSuccess({
      message: 'Credentials updated successfully',
      token: newToken,
      company: safeCompany,
    });

    // Update session cookie
    response.cookies.set('session', newToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('Update credentials error:', error);
    return apiError('Failed to update company credentials', 500);
  }
}
