import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiError, apiSuccess } from '@/lib/response';

/**
 * GET /api/sync/data
 * Protected endpoint prepared for future Stage 7 Flutter synchronization.
 *
 * Capabilities:
 * - Strictly scoped to authenticated company (zero data leakage).
 * - Version-aware check: Client sends `?version=xxx`. If current data_version matches,
 *   returns `{ up_to_date: true }` without transmitting the catalog payload.
 * - Supports pagination: `?limit=1000&offset=0`.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth.authenticated) {
      return apiError(auth.error, auth.status);
    }

    const { company } = auth;
    const searchParams = request.nextUrl.searchParams;
    const clientVersion = searchParams.get('version');
    const limitParam = searchParams.get('limit');
    const offsetParam = searchParams.get('offset');

    // Version-aware check: avoid transferring catalog if client is already on current version
    if (clientVersion && clientVersion === company.data_version && company.data_version !== null) {
      return apiSuccess({
        up_to_date: true,
        data_version: company.data_version,
        item_count: company.item_count,
        last_sync_at: company.last_sync_at,
        items: [],
      });
    }

    const limit = limitParam ? parseInt(limitParam, 10) : undefined;
    const offset = offsetParam ? parseInt(offsetParam, 10) : undefined;

    const { items, total } = await db.getCompanyItems(company.id, {
      limit: limit && !isNaN(limit) ? Math.min(Math.max(limit, 1), 10000) : undefined,
      offset: offset && !isNaN(offset) ? Math.max(offset, 0) : undefined,
    });

    return apiSuccess({
      up_to_date: false,
      data_version: company.data_version,
      item_count: total,
      returned_count: items.length,
      last_sync_at: company.last_sync_at,
      items: items.map((item) => ({
        i_code: item.i_code,
        item_name: item.item_name,
        describe: item.describe,
        quantity: item.quantity,
        rate: item.rate,
        disc_per: item.disc_per,
        disc_b: item.disc_b,
      })),
    });
  } catch (error: any) {
    console.error('Fetch company sync data error:', error);
    return apiError('Failed to fetch synchronized item catalog', 500);
  }
}
