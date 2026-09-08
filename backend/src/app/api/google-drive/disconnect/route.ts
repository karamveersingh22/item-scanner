import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiError, apiSuccess } from '@/lib/response';

/**
 * POST /api/google-drive/disconnect
 * Safely unlinks the company's Google Drive connection.
 * Purges encrypted refresh tokens and file associations without affecting files in user's Drive.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth.authenticated) {
      return apiError(auth.error, auth.status);
    }

    const { company } = auth;

    await db.updateCompanySyncState(company.id, {
      google_refresh_token: null,
      google_drive_file_id: null,
      google_drive_file_name: null,
      google_drive_folder_id: null,
    });

    return apiSuccess({
      message: 'Google Drive disconnected successfully. Stored authorizations have been removed.',
    });
  } catch (error: any) {
    console.error('Drive disconnect error:', error);
    return apiError(error.message || 'Failed to disconnect Google Drive', 500);
  }
}
