import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { db } from '@/lib/db';
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
    console.error('Get company profile error:', error);
    return apiError('Failed to fetch company profile', 500);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth.authenticated) {
      return apiError(auth.error, auth.status);
    }

    const body = await request.json();
    const { company_name } = body;

    if (company_name !== undefined) {
      if (typeof company_name !== 'string' || !company_name.trim()) {
        return apiError('Company name cannot be empty', 400);
      }
    }

    const updated = await db.updateCompanyProfile(auth.company.id, {
      company_name: company_name ? company_name.trim() : undefined,
    });

    if (!updated) {
      return apiError('Company not found', 404);
    }

    return apiSuccess({
      message: 'Company profile updated successfully',
      company: toSafeCompany(updated),
    });
  } catch (error) {
    console.error('Update company profile error:', error);
    return apiError('Failed to update company profile', 500);
  }
}
