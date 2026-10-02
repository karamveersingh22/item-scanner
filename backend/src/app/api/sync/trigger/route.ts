import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { db } from '@/lib/db';
import { downloadDriveFile, getDriveFileMetadata, findTargetSpreadsheet, DriveFileItem } from '@/lib/google-drive';
import { parseExcelBuffer, ExcelValidationError, PARSER_SCHEMA_VERSION } from '@/lib/excel-parser';
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

    // 2. Resolve target file: use stored file_id if valid, else auto-detect ITEMMAST.xlsx
    let targetFileId = company.google_drive_file_id;
    let targetFileName = company.google_drive_file_name;
    let targetFolderId = company.google_drive_folder_id;

    // If no stored file_id, or we want to auto-detect on every sync (simpler for client)
    // Try stored file first, if not found (404), auto-detect
    let useStoredFile = Boolean(targetFileId);

    if (useStoredFile) {
      try {
        // Quick metadata check to verify stored file still exists
        await getDriveFileMetadata(company);
      } catch (err: any) {
        console.warn('Stored file metadata check failed, falling back to auto-detect:', err.message);
        // Stored file not found (deleted/replaced), fall back to auto-detect
        useStoredFile = false;
      }
    }

    if (!useStoredFile) {
      // Auto-detect: find ITEMMAST.xlsx (or only xlsx file)
      let target: DriveFileItem | null = null;
      try {
        target = await findTargetSpreadsheet(company);
      } catch (err: any) {
        console.error('Auto-detect failed:', err.message);
        // Check if it's an auth error (token expired)
        if (err.message?.includes('401') || err.message?.includes('403') || err.message?.includes('unauthorized') || err.message?.includes('invalid_grant')) {
          return apiError(
            'Google Drive authorization expired. Please reconnect Drive in the admin panel.',
            401
          );
        }
        return apiError(
          `Failed to list Drive files: ${err.message}`,
          500
        );
      }
      
      if (!target) {
        return apiError(
          'No Excel spreadsheet (.xlsx) found in Google Drive. Please upload ITEMMAST.xlsx first.',
          400
        );
      }
      targetFileId = target.id;
      targetFileName = target.name;
      // Persist the auto-detected file for future syncs
      await db.updateCompanySyncState(company.id, {
        google_drive_file_id: targetFileId,
        google_drive_file_name: targetFileName,
        google_drive_folder_id: targetFolderId,
      });
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
    // Check if the selected Drive file has changed since the last successful synchronization.
    // Compares remote Drive md5Checksum with company.google_drive_md5 (NOT data_version).
    //
    // IMPORTANT: Also bypasses this short-circuit when PARSER_SCHEMA_VERSION has changed
    // since the last catalog was published. This ensures that parser schema upgrades
    // (e.g. adding disc_a..disc_n + tax_per) force a re-parse even if the Drive file
    // itself hasn't changed.
    let remoteMetadata: { md5Checksum?: string; modifiedTime?: string } | null = null;
    let schemaUpgradeNeeded = false;

    // Detect schema upgrade: if the current data_version was computed with an older
    // PARSER_SCHEMA_VERSION, the catalog in Blob is stale and must be re-published.
    if (company.data_version) {
      // Re-parsing the same file with the new schema version will produce a different
      // data_version hash (because PARSER_SCHEMA_VERSION is mixed in). If the stored
      // data_version was produced with an older schema, we need to force re-parse.
      // We detect this cheaply: check if any existing catalog item has the new fields.
      try {
        const currentCatalog = await db.getCompanyItems(company.id, { limit: 1 });
        if (currentCatalog.items.length > 0) {
          const sampleItem = currentCatalog.items[0] as any;
          // If disc_a is missing from the stored catalog, schema upgrade is needed
          if (sampleItem.disc_a === undefined && sampleItem.disc_a !== null) {
            schemaUpgradeNeeded = true;
            console.log(`Schema upgrade detected: PARSER_SCHEMA_VERSION=${PARSER_SCHEMA_VERSION}, catalog missing new columns. Forcing re-parse.`);
          }
        }
      } catch {
        // If we can't check, assume upgrade is needed to be safe
        schemaUpgradeNeeded = true;
      }
    }

    try {
      if (targetFileId) {
        remoteMetadata = await getDriveFileMetadata(company, targetFileId);
      }
      if (
        !schemaUpgradeNeeded &&
        remoteMetadata?.md5Checksum &&
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
      if (!targetFileId) throw new Error('No target file ID resolved');
      downloadResult = await downloadDriveFile(company, targetFileId);
    } catch (err: any) {
      console.error('Drive download failed:', err.message);
      // Check for auth errors
      if (err.message?.includes('401') || err.message?.includes('403') || err.message?.includes('unauthorized') || err.message?.includes('invalid_grant')) {
        throw new Error('Google Drive authorization expired. Please reconnect Drive in the admin panel.');
      }
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
    let parseResult: { items: any[]; item_count: number; data_version: string };
    try {
      parseResult = parseExcelBuffer(buffer);
    } catch (err: any) {
      console.error('Excel parse failed:', err.message);
      throw new Error(`Invalid Excel file: ${err.message}`);
    }

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
      message: `Successfully synchronized ${parseResult.item_count} items from ${targetFileName || 'itemmast.xlsx'}.`,
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
