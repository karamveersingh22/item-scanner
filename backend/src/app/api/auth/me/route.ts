import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { apiError, apiSuccess } from '@/lib/response';
import { toSafeCompany } from '@/lib/types';

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth.authenticated) {
      return apiError(auth.error, auth.status);
    }

    return apiSuccess({
      company: toSafeCompany(auth.company),
    });
  } catch (error) {
    console.error('Auth me error:', error);
    return apiError('Failed to retrieve authentication session', 500);
  }
}
