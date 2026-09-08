import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { listSpreadsheetsInDrive } from '@/lib/google-drive';
import { apiError, apiSuccess } from '@/lib/response';

/**
 * GET /api/google-drive/files
 * Lists accessible spreadsheet (.xlsx) files from the authenticated company's Google Drive.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth.authenticated) {
      return apiError(auth.error, auth.status);
    }

    const { company } = auth;
    if (!company.google_refresh_token) {
      return apiError('Google Drive is not connected. Please connect Google Drive first.', 400);
    }

    const files = await listSpreadsheetsInDrive(company);

    return apiSuccess({
      files,
    });
  } catch (error: any) {
    console.error('List Drive files error:', error);
    return apiError(error.message || 'Failed to list Google Drive files', 500);
  }
}
