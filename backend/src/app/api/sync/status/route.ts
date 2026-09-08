import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { apiError, apiSuccess } from '@/lib/response';

/**
 * GET /api/sync/status
 * Placeholder for Stage 6 & 7 (Data Synchronization)
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth.authenticated) {
      return apiError(auth.error, auth.status);
    }

    const { company } = auth;
    return apiSuccess({
      sync_status: company.sync_status,
      last_sync_at: company.last_sync_at,
      item_count: company.item_count,
      data_version: company.data_version,
      google_drive_md5: company.google_drive_md5,
      google_drive_modified_time: company.google_drive_modified_time,
      sync_error: company.sync_error,
      file_name: company.google_drive_file_name,
      file_id: company.google_drive_file_id,
    });
  } catch (error) {
    console.error('Sync status error:', error);
    return apiError('Failed to fetch sync status', 500);
  }
}
