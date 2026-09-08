import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyOAuthState, exchangeCodeForTokens } from '@/lib/google-drive';
import { encryptToken } from '@/lib/encryption';
import { apiError } from '@/lib/response';

/**
 * GET /api/google-drive/callback
 * Google OAuth2 redirect handler.
 * Validates cryptographic state, exchanges authorization code for tokens,
 * encrypts the refresh token using AES-256-GCM, and commits it to the database.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  const redirectBase = request.nextUrl.origin;

  // 1. Handle user denied consent or Google error
  if (error) {
    return NextResponse.redirect(`${redirectBase}/admin/sync?drive_error=${encodeURIComponent(error)}`);
  }

  if (!code || !state) {
    return apiError('Missing required authorization code or state parameter', 400);
  }

  // 2. Validate cryptographic state to prevent CSRF and extract company_id
  const stateResult = verifyOAuthState(state);
  if (!stateResult.valid || !stateResult.company_id) {
    return NextResponse.redirect(
      `${redirectBase}/admin/sync?drive_error=${encodeURIComponent(stateResult.error || 'Invalid state')}`
    );
  }

  const companyId = stateResult.company_id;

  try {
    // 3. Exchange code for access & refresh tokens
    const { refresh_token } = await exchangeCodeForTokens(code);

    if (!refresh_token) {
      return NextResponse.redirect(
        `${redirectBase}/admin/sync?drive_error=${encodeURIComponent('No refresh token received from Google')}`
      );
    }

    // 4. Encrypt refresh token using AES-256-GCM before database persistence
    const encryptedRefreshToken = encryptToken(refresh_token);

    // 5. Update company Drive state
    await db.updateCompanySyncState(companyId, {
      google_refresh_token: encryptedRefreshToken,
    });

    // 6. Safe redirect back to the Company Management Panel (zero tokens in URL)
    return NextResponse.redirect(`${redirectBase}/admin/sync?drive_connected=true`);
  } catch (err: any) {
    console.error('Google OAuth callback error:', err);
    return NextResponse.redirect(
      `${redirectBase}/admin/sync?drive_error=${encodeURIComponent(err.message || 'OAuth exchange failed')}`
    );
  }
}
