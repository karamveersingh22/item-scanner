import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { apiError, apiSuccess } from '@/lib/response';

/**
 * GET /api/google-drive/status
 * Placeholder for Stage 5 (Google Drive Integration)
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth.authenticated) {
      return apiError(auth.error, auth.status);
    }

    const { company } = auth;
    return apiSuccess({
      connected: Boolean(company.google_refresh_token),
      folder_id: company.google_drive_folder_id,
      file_id: company.google_drive_file_id,
      file_name: company.google_drive_file_name,
    });
  } catch (error) {
    console.error('Drive status error:', error);
    return apiError('Failed to fetch Drive status', 500);
  }
}
