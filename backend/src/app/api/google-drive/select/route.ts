import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiError, apiSuccess } from '@/lib/response';

/**
 * POST /api/google-drive/select
 * Validates and associates the selected Google Drive file with the authenticated company.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth.authenticated) {
      return apiError(auth.error, auth.status);
    }

    const { company } = auth;
    if (!company.google_refresh_token) {
      return apiError('Google Drive must be connected before selecting a file', 400);
    }

    const body = await request.json();
    const { file_id, file_name, folder_id } = body;

    if (!file_id || typeof file_id !== 'string' || !file_id.trim()) {
      return apiError('file_id is required', 400);
    }

    if (!file_name || typeof file_name !== 'string' || !file_name.trim()) {
      return apiError('file_name is required', 400);
    }

    const cleanFileName = file_name.trim();

    // Validate supported file format (.xlsx)
    if (!cleanFileName.toLowerCase().endsWith('.xlsx')) {
      return apiError('Only Excel spreadsheet (.xlsx) files are supported as Item Master data sources', 400);
    }

    // Update the company's selected file configuration in the database
    const updated = await db.updateCompanySyncState(company.id, {
      google_drive_file_id: file_id.trim(),
      google_drive_file_name: cleanFileName,
      google_drive_folder_id: folder_id ? folder_id.trim() : null,
    });

    if (!updated) {
      return apiError('Failed to update company file selection', 500);
    }

    return apiSuccess({
      message: `File '${cleanFileName}' successfully selected as Item Master source.`,
      file_id: updated.google_drive_file_id,
      file_name: updated.google_drive_file_name,
      folder_id: updated.google_drive_folder_id,
    });
  } catch (error: any) {
    console.error('File selection error:', error);
    return apiError(error.message || 'Failed to select Google Drive file', 500);
  }
}
