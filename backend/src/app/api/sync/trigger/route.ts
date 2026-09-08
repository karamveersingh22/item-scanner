import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { db } from '@/lib/db';
import { downloadDriveFile, getDriveFileMetadata } from '@/lib/google-drive';
import { parseExcelBuffer, ExcelValidationError } from '@/lib/excel-parser';
import { apiError, apiSuccess } from '@/lib/response';

/**
 * POST /api/sync/trigger
 * Triggers server-side synchronization of the authenticated company's selected itemmast.xlsx.
 *
 * Security & Isolation:
 * - Derives company identity exclusively from the authenticated session (JWT cookie/bearer).
 * - Ignores any client-supplied company_id or file_id.
 * - Protects against concurrent syncs via per-company lock.
 * - Atomic publishing: previous successful catalog remains active if any step fails.
 */
export async function POST(request: NextRequest) {
  let authenticatedCompanyId: string | null = null;
  let lockAcquired = false;

  try {
    const auth = await authenticateRequest(request);
    if (!auth.authenticated) {
      return apiError(auth.error, auth.status);
    }

    const { company } = auth;
    authenticatedCompanyId = company.id;

    // 1. Verify Google Drive is connected
    if (!company.google_refresh_token) {
      return apiError(
        'Google Drive is not connected for this company. Please connect Google Drive first.',
        400
      );
    }

    // 2. Verify an Excel spreadsheet file has been selected
    if (!company.google_drive_file_id) {
      return apiError(
        'No Google Drive file has been selected as the Item Master source. Please select itemmast.xlsx in the management panel.',
        400
      );
    }

    // 3. Concurrent Sync Protection
    // Prevent multiple sync operations for the same company from executing simultaneously
    lockAcquired = await db.acquireSyncLock(company.id);
    if (!lockAcquired) {
      return apiError(
        'Synchronization is already in progress for this company. Please wait for the current run to complete.',
        409
      );
    }

    // 4. No-Change Optimization
    // Check if the selected Drive file has changed since the last successful synchronization
    // Compares remote Drive md5Checksum with company.google_drive_md5 (NOT data_version)
    let remoteMetadata: { md5Checksum?: string; modifiedTime?: string } | null = null;
    try {
      remoteMetadata = await getDriveFileMetadata(company);
      if (
        remoteMetadata.md5Checksum &&
        company.google_drive_md5 &&
        remoteMetadata.md5Checksum === company.google_drive_md5 &&
        company.item_count > 0
      ) {
        // Restore status to SUCCESS and release lock
        await db.updateCompanySyncState(company.id, { sync_status: 'SUCCESS' });
        await db.releaseSyncLock(company.id);
        return apiSuccess({
          unchanged: true,
          message: 'Catalog is already synchronized and up to date with Google Drive.',
          item_count: company.item_count,
          data_version: company.data_version,
          google_drive_md5: company.google_drive_md5,
          sync_status: 'SUCCESS',
          last_sync_at: company.last_sync_at,
        });
      }
    } catch {
      // Best-effort metadata check; proceed to full download if metadata lookup fails
    }

    // 5. Download selected Excel file from Google Drive API
    const downloadStart = Date.now();
    let downloadResult: { buffer: Buffer; md5Checksum?: string; modifiedTime?: string };
    try {
      downloadResult = await downloadDriveFile(company);
    } catch (err: any) {
      throw new Error(`Google Drive download failed: ${err.message}`);
    }

    const { buffer } = downloadResult;
    const finalDriveMd5 = downloadResult.md5Checksum || remoteMetadata?.md5Checksum || null;
    const finalDriveModified = downloadResult.modifiedTime
      ? new Date(downloadResult.modifiedTime)
      : remoteMetadata?.modifiedTime
      ? new Date(remoteMetadata.modifiedTime)
      : null;

    // 6. Validate & Parse Excel File
    // Enforces mandatory columns, preserves leading zeros in I_CODE, and rejects duplicate I_CODEs
    const parseResult = parseExcelBuffer(buffer);

    // 7. Atomic Database Ingestion
    // Saves new Drive md5Checksum into google_drive_md5, deterministic catalog hash into data_version,
    // updates item_count and sync_status='SUCCESS'.
    // The previous catalog remains completely available until this atomic step commits.
    await db.publishCompanyItems(
      company.id,
      parseResult.items,
      parseResult.data_version,
      {
        google_drive_md5: finalDriveMd5,
        google_drive_modified_time: finalDriveModified,
      }
    );

    const totalDuration = Date.now() - downloadStart;

    return apiSuccess({
      message: `Successfully synchronized ${parseResult.item_count} items from ${company.google_drive_file_name || 'itemmast.xlsx'}.`,
      item_count: parseResult.item_count,
      data_version: parseResult.data_version,
      google_drive_md5: finalDriveMd5,
      sync_status: 'SUCCESS',
      last_sync_at: new Date().toISOString(),
      duration_ms: totalDuration,
    });
  } catch (error: any) {
    console.error('Synchronization failed:', error.message);

    // If lock was acquired, record failure safely while preserving previous catalog
    if (authenticatedCompanyId && lockAcquired) {
      await db.recordSyncFailure(authenticatedCompanyId, error.message || 'Synchronization failed');
    }

    const statusCode = error instanceof ExcelValidationError ? 400 : 500;
    return apiError(error.message || 'Failed to synchronize spreadsheet from Google Drive', statusCode);
  }
}
