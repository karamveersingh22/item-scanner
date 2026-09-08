import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { getAuthorizationUrl } from '@/lib/google-drive';
import { apiError, apiSuccess } from '@/lib/response';

/**
 * GET /api/google-drive/auth-url
 * Generates the Google OAuth authorization URL for the authenticated company.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth.authenticated) {
      return apiError(auth.error, auth.status);
    }

    const authUrl = getAuthorizationUrl(auth.company.id);

    return apiSuccess({
      auth_url: authUrl,
    });
  } catch (error) {
    console.error('Failed to generate Google Drive auth URL:', error);
    return apiError('Could not generate authorization URL', 500);
  }
}
