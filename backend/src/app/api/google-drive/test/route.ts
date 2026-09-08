import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { testDriveConnection } from '@/lib/google-drive';
import { apiError, apiSuccess } from '@/lib/response';

/**
 * GET /api/google-drive/test
 * Verifies that the stored company Google Drive connection is active and healthy.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth.authenticated) {
      return apiError(auth.error, auth.status);
    }

    const { company } = auth;
    const testResult = await testDriveConnection(company);

    return apiSuccess(testResult);
  } catch (error: any) {
    console.error('Drive connection test error:', error);
    return apiError(error.message || 'Drive connection test failed', 500);
  }
}
