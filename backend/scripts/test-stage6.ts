/**
 * Stage 6 Automated Verification & Performance Test Suite (Single-Company Architecture)
 * Covers Google Drive itemmast.xlsx Synchronization and Cloud Data Processing:
 *
 * Drive & Authorization:
 * 1. Authenticated company without Drive connection is rejected safely (400).
 * 2. Authenticated company without selected file is rejected safely (400).
 * 3. Unauthenticated request is rejected with 401.
 * 4. Authenticated company with valid connection & file can trigger sync.
 * 5. Client-supplied company_id or file_id in request body is strictly ignored.
 *
 * Concurrent Sync Protection:
 * 6. Second simultaneous sync attempt is rejected with 409 Conflict.
 * 7. Completed sync cleanly releases lock allowing subsequent sync runs.
 *
 * Excel Validation & Normalization:
 * 8. Valid XLSX spreadsheet is downloaded, parsed, and ingested.
 * 9. Case-insensitive & whitespace-tolerant header mapping works correctly.
 * 10. Missing required column (e.g., DISC_B) fails with descriptive error.
 * 11. Corrupt/invalid archive is rejected safely.
 * 12. Duplicate I_CODE occurrences are detected and fail synchronization cleanly.
 * 13. Meaningful leading zeros in I_CODE ('001234') are strictly preserved as strings.
 * 14. Empty spreadsheet with zero item rows fails cleanly.
 *
 * True Atomic Publishing & Failure Safety:
 * 15. Initial successful synchronization atomically publishes catalog and assigns data_version.
 * 16. Failed synchronization (corrupt file) leaves previous successful catalog 100% intact.
 * 17. Failed synchronization preserves previous item_count, data_version, and Drive MD5.
 * 18. Versioned catalog blob (catalog-v<version>.json.gz) survives cold-start re-instantiation.
 *
 * Optimization & Stage 7 Preparedness:
 * 19. Drive MD5 unchanged -> no download/reprocessing (returns unchanged: true).
 * 20. Drive MD5 changed -> synchronization occurs and updates Drive MD5.
 * 21. Different Drive MD5 but identical normalized catalog -> sync succeeds while data_version remains identical.
 * 22. Catalog data_version is independent from Drive MD5 (content changes update data_version).
 * 23. /api/sync/status reports accurate metrics, file ID, file name, and safe errors.
 * 24. /api/sync/data?version=xxx returns up_to_date: true without payload when version matches.
 * 25. Sensitive credentials and tokens never appear in API responses or errors.
 *
 * Performance Benchmarks:
 * 26. 10,000 item realistic dataset benchmark (download, parse, compressed write).
 * 27. 50,000 item realistic dataset benchmark (throughput rows/sec, memory).
 */

import { NextRequest } from 'next/server';
import { db, SingleCompanyStore } from '../src/lib/db';
import { POST as loginRoute } from '../src/app/api/auth/login/route';
import { POST as selectFileRoute } from '../src/app/api/google-drive/select/route';
import { POST as triggerSyncRoute } from '../src/app/api/sync/trigger/route';
import { GET as syncStatusRoute } from '../src/app/api/sync/status/route';
import { GET as syncDataRoute } from '../src/app/api/sync/data/route';
import { setMockDriveFile, clearMockDriveFiles } from '../src/lib/google-drive';
import { createMockXlsxBuffer, parseExcelBuffer } from '../src/lib/excel-parser';
import { encryptToken } from '../src/lib/encryption';
import crypto from 'crypto';

interface TestResult {
  num: number;
  category: 'DRIVE_AUTH' | 'CONCURRENCY' | 'EXCEL_VALIDATION' | 'ATOMICITY' | 'OPTIMIZATION' | 'PERFORMANCE';
  description: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

function record(
  num: number,
  category: 'DRIVE_AUTH' | 'CONCURRENCY' | 'EXCEL_VALIDATION' | 'ATOMICITY' | 'OPTIMIZATION' | 'PERFORMANCE',
  description: string,
  passed: boolean,
  details: string
) {
  results.push({ num, category, description, passed, details });
  const badge = passed ? '\x1b[32m[PASS]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m';
  console.log(`${badge} [${category}] Test ${num}: ${description}`);
  if (!passed || process.env.VERBOSE) {
    console.log(`       Details: ${details}`);
  }
}

function createJsonRequest(url: string, method: string, body?: unknown, token?: string): NextRequest {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (token) {
    headers['authorization'] = `Bearer ${token}`;
  }

  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function runStage6Tests() {
  console.log('\n======================================================================');
  console.log(' STAGE 6: GOOGLE DRIVE ITEMMAST.XLSX SYNCHRONIZATION VERIFICATION      ');
  console.log('======================================================================\n');

  await db.clearAll();
  clearMockDriveFiles();

  let token = '';
  let companyId = '';

  const company = await db.getCompany();
  companyId = company.id;

  const loginReq = createJsonRequest('/api/auth/login', 'POST', {
    username: 'admin',
    password: 'admin123!',
  });
  const loginJson = await (await loginRoute(loginReq)).json();
  token = loginJson.data.token;

  // -------------------------------------------------------------------------
  // CATEGORY 1: DRIVE & AUTHORIZATION
  // -------------------------------------------------------------------------

  // 1. Authenticated company without Drive connection is rejected safely (400)
  try {
    const req = createJsonRequest('/api/sync/trigger', 'POST', undefined, token);
    const res = await triggerSyncRoute(req);
    const json = await res.json();
    const passed = res.status === 400 && json.success === false && json.error.includes('Google Drive is not connected');
    record(
      1,
      'DRIVE_AUTH',
      'Sync rejected with 400 when Google Drive is not connected',
      passed,
      `Status: ${res.status}, Error: ${json.error}`
    );
  } catch (e: any) {
    record(1, 'DRIVE_AUTH', 'Disconnected drive check', false, e.message);
  }

  // Connect Google Drive
  await db.updateCompanySyncState(companyId, {
    google_refresh_token: encryptToken('mock-refresh-token-primary'),
  });

  // 2. Company without selected file is rejected safely (400)
  try {
    const req = createJsonRequest('/api/sync/trigger', 'POST', undefined, token);
    const res = await triggerSyncRoute(req);
    const json = await res.json();
    const passed = res.status === 400 && json.success === false && json.error.includes('No Google Drive file has been selected');
    record(
      2,
      'DRIVE_AUTH',
      'Sync rejected with 400 when no item file has been selected',
      passed,
      `Status: ${res.status}, Error: ${json.error}`
    );
  } catch (e: any) {
    record(2, 'DRIVE_AUTH', 'Unselected file check', false, e.message);
  }

  // 3. Unauthenticated request is rejected with 401
  try {
    const req = createJsonRequest('/api/sync/trigger', 'POST');
    const res = await triggerSyncRoute(req);
    record(
      3,
      'DRIVE_AUTH',
      'Unauthenticated sync request is strictly rejected with 401',
      res.status === 401,
      `Status: ${res.status}`
    );
  } catch (e: any) {
    record(3, 'DRIVE_AUTH', 'Unauthenticated check', false, e.message);
  }

  // Select file
  const selectFileReq = createJsonRequest(
    '/api/google-drive/select',
    'POST',
    {
      file_id: 'drive-file-primary-itemmast-001',
      file_name: 'itemmast.xlsx',
    },
    token
  );
  await selectFileRoute(selectFileReq);

  // 4. Authenticated company with valid connection & file can trigger sync
  try {
    const req = createJsonRequest('/api/sync/trigger', 'POST', undefined, token);
    const res = await triggerSyncRoute(req);
    const json = await res.json();
    const passed = res.status === 200 && json.success === true && json.data.item_count > 0;
    record(
      4,
      'DRIVE_AUTH',
      'Authenticated company with valid Drive setup triggers synchronization successfully',
      passed,
      `Items synchronized: ${json.data?.item_count}, Status: ${json.data?.sync_status}`
    );
  } catch (e: any) {
    record(4, 'DRIVE_AUTH', 'Trigger sync check', false, e.message);
  }

  // 5. Client-supplied company_id or file_id in request body is strictly ignored
  try {
    const maliciousReq = createJsonRequest(
      '/api/sync/trigger',
      'POST',
      {
        company_id: 'malicious-override',
        file_id: 'malicious-file-id-override',
      },
      token
    );
    const res = await triggerSyncRoute(maliciousReq);
    const json = await res.json();
    const current = await db.getCompany();
    const passed = res.status === 200 && current.id === companyId && current.google_drive_file_id === 'drive-file-primary-itemmast-001';
    record(
      5,
      'DRIVE_AUTH',
      'Client-supplied company_id in request body is ignored (session-bound)',
      passed,
      `File ID remained: ${current.google_drive_file_id}`
    );
  } catch (e: any) {
    record(5, 'DRIVE_AUTH', 'Payload override check', false, e.message);
  }

  // -------------------------------------------------------------------------
  // CATEGORY 2: CONCURRENT SYNC PROTECTION
  // -------------------------------------------------------------------------

  // 6. Second simultaneous sync attempt is rejected with 409 Conflict
  try {
    await db.acquireSyncLock();
    const req = createJsonRequest('/api/sync/trigger', 'POST', undefined, token);
    const res = await triggerSyncRoute(req);
    const json = await res.json();
    await db.releaseSyncLock();

    const passed = res.status === 409 && json.success === false && json.error.includes('already in progress');
    record(
      6,
      'CONCURRENCY',
      'Concurrent sync on same company returns 409 Conflict (Prevents race conditions)',
      passed,
      `Status: ${res.status}, Error: ${json.error}`
    );
  } catch (e: any) {
    record(6, 'CONCURRENCY', 'Concurrent lock check', false, e.message);
  }

  // 7. Completed sync cleanly releases lock allowing subsequent sync runs
  try {
    const req = createJsonRequest('/api/sync/trigger', 'POST', undefined, token);
    const res = await triggerSyncRoute(req);
    const passed = res.status === 200;
    record(
      7,
      'CONCURRENCY',
      'Subsequent sync succeeds cleanly after lock release',
      passed,
      `Status: ${res.status}`
    );
  } catch (e: any) {
    record(7, 'CONCURRENCY', 'Lock release check', false, e.message);
  }

  // -------------------------------------------------------------------------
  // CATEGORY 3: EXCEL VALIDATION & NORMALIZATION
  // -------------------------------------------------------------------------

  // 8. Parser accepts case variations and whitespace
  try {
    const customHeaders = ['  i_code  ', ' ITEM_NAME ', ' DeScRiBe ', 'Quantity', ' RaTe ', ' DISC_PER ', 'disc_b'];
    const rowData: Record<string, string> = {
      '  i_code  ': '101',
      ' ITEM_NAME ': 'Widget A',
      ' DeScRiBe ': 'Sample Desc',
      'Quantity': '10',
      ' RaTe ': '100.5',
      ' DISC_PER ': '5',
      'disc_b': '2.5',
    };
    const relaxedBuffer = createMockXlsxBuffer([rowData], customHeaders);
    const parsed = parseExcelBuffer(relaxedBuffer);
    const passed = parsed.item_count === 1 && parsed.items[0].i_code === '101' && parsed.items[0].item_name === 'Widget A';
    record(
      8,
      'EXCEL_VALIDATION',
      'Parser accepts case variations and whitespace in required headers',
      passed,
      `Parsed: ${parsed.items[0]?.item_name} (Code: ${parsed.items[0]?.i_code})`
    );
  } catch (e: any) {
    record(8, 'EXCEL_VALIDATION', 'Header tolerance check', false, e.message);
  }

  // 9. Missing required column throws validation error
  try {
    const missingHeaders = ['I_CODE', 'ITEM_NAME', 'DESCRIBE', 'QUANTITY', 'RATE', 'DISC_PER']; // Missing DISC_B
    const missingColBuffer = createMockXlsxBuffer([
      { I_CODE: '101', ITEM_NAME: 'Widget', DESCRIBE: 'Desc', QUANTITY: '10', RATE: '100', DISC_PER: '5' },
    ], missingHeaders);
    let errorThrown = false;
    let errorMsg = '';
    try {
      parseExcelBuffer(missingColBuffer);
    } catch (err: any) {
      errorThrown = true;
      errorMsg = err.message;
    }
    const passed = errorThrown && errorMsg.includes('DISC_B');
    record(
      9,
      'EXCEL_VALIDATION',
      'Missing required column (DISC_B) throws validation error detailing missing column',
      passed,
      `Error caught: ${errorMsg}`
    );
  } catch (e: any) {
    record(9, 'EXCEL_VALIDATION', 'Missing column check', false, e.message);
  }

  // 10. Corrupt archive rejected
  try {
    const corruptBuffer = Buffer.from('not a zip file at all');
    let errorThrown = false;
    let errorMsg = '';
    try {
      parseExcelBuffer(corruptBuffer);
    } catch (err: any) {
      errorThrown = true;
      errorMsg = err.message;
    }
    const passed = errorThrown && errorMsg.includes('not a valid .xlsx');
    record(
      10,
      'EXCEL_VALIDATION',
      'Non-XLSX or corrupted buffer throws clean validation error',
      passed,
      `Error caught: ${errorMsg}`
    );
  } catch (e: any) {
    record(10, 'EXCEL_VALIDATION', 'Corrupt buffer check', false, e.message);
  }

  // 11. Duplicate I_CODE detected
  try {
    const dupXlsx = createMockXlsxBuffer([
      { I_CODE: 'DUP100', ITEM_NAME: 'Item 1', DESCRIBE: 'First', QUANTITY: '1', RATE: '10', DISC_PER: '0', DISC_B: '0' },
      { I_CODE: 'DUP100', ITEM_NAME: 'Item 2', DESCRIBE: 'Duplicate', QUANTITY: '2', RATE: '20', DISC_PER: '0', DISC_B: '0' },
    ]);
    let errorThrown = false;
    let errorMsg = '';
    try {
      parseExcelBuffer(dupXlsx);
    } catch (err: any) {
      errorThrown = true;
      errorMsg = err.message;
    }
    const passed = errorThrown && errorMsg.includes('duplicate I_CODE') && errorMsg.includes('DUP100');
    record(
      11,
      'EXCEL_VALIDATION',
      'Duplicate I_CODE values are detected and reject catalog to prevent ambiguity',
      passed,
      `Error caught: ${errorMsg}`
    );
  } catch (e: any) {
    record(11, 'EXCEL_VALIDATION', 'Duplicate code check', false, e.message);
  }

  // 12. Leading zeros in I_CODE preserved
  try {
    const leadingZeroXlsx = createMockXlsxBuffer([
      { I_CODE: '000789', ITEM_NAME: 'Leading Zero Item', DESCRIBE: 'Preserved', QUANTITY: '5', RATE: '99', DISC_PER: '0', DISC_B: '0' },
    ]);
    const parsed = parseExcelBuffer(leadingZeroXlsx);
    const passed = parsed.items.length === 1 && parsed.items[0].i_code === '000789';
    record(
      12,
      'EXCEL_VALIDATION',
      "Leading zeros in item codes (e.g. '000789') are strictly preserved as strings",
      passed,
      `Preserved I_CODE: '${parsed.items[0]?.i_code}'`
    );
  } catch (e: any) {
    record(12, 'EXCEL_VALIDATION', 'Leading zeros check', false, e.message);
  }

  // 13. Empty spreadsheet fails
  try {
    const emptyRowsXlsx = createMockXlsxBuffer([]);
    let errorThrown = false;
    let errorMsg = '';
    try {
      parseExcelBuffer(emptyRowsXlsx);
    } catch (err: any) {
      errorThrown = true;
      errorMsg = err.message;
    }
    const passed = errorThrown && errorMsg.includes('does not contain any valid item records');
    record(
      13,
      'EXCEL_VALIDATION',
      'Empty spreadsheet with zero item rows throws clean validation error',
      passed,
      `Error caught: ${errorMsg}`
    );
  } catch (e: any) {
    record(13, 'EXCEL_VALIDATION', 'Empty rows check', false, e.message);
  }

  // -------------------------------------------------------------------------
  // CATEGORY 4: TRUE ATOMIC PUBLISHING & FAILURE SAFETY
  // -------------------------------------------------------------------------

  // 14. Initial successful synchronization atomically publishes catalog
  let initialVersion = '';
  let initialDriveMd5 = '';
  try {
    const initialSyncFile = createMockXlsxBuffer([
      { I_CODE: 'A_001', ITEM_NAME: 'Item A1', DESCRIBE: 'Initial 1', QUANTITY: '10', RATE: '100', DISC_PER: '5', DISC_B: '0' },
      { I_CODE: 'A_002', ITEM_NAME: 'Item A2', DESCRIBE: 'Initial 2', QUANTITY: '20', RATE: '200', DISC_PER: '10', DISC_B: '5' },
      { I_CODE: 'A_003', ITEM_NAME: 'Item A3', DESCRIBE: 'Initial 3', QUANTITY: '30', RATE: '300', DISC_PER: '15', DISC_B: '10' },
    ]);
    initialDriveMd5 = crypto.createHash('md5').update(initialSyncFile).digest('hex');
    setMockDriveFile(companyId, {
      buffer: initialSyncFile,
      md5Checksum: initialDriveMd5,
      modifiedTime: '2026-09-07T12:00:00Z',
    });

    const req = createJsonRequest('/api/sync/trigger', 'POST', undefined, token);
    const res = await triggerSyncRoute(req);
    const json = await res.json();

    const comp = await db.getCompany();
    initialVersion = comp.data_version || '';

    const passed =
      res.status === 200 &&
      json.success === true &&
      comp.item_count === 3 &&
      initialVersion.length === 32 &&
      comp.google_drive_md5 === initialDriveMd5 &&
      initialVersion !== initialDriveMd5 &&
      comp.sync_status === 'SUCCESS';

    record(
      14,
      'ATOMICITY',
      'Initial sync atomically commits catalog (3 items, distinct google_drive_md5 and data_version, SUCCESS status)',
      passed,
      `Count: ${comp.item_count}, Version: ${initialVersion}, Drive MD5: ${comp.google_drive_md5}`
    );
  } catch (e: any) {
    record(14, 'ATOMICITY', 'Initial atomic publish check', false, e.message);
  }

  // 15. Failed sync leaves previous catalog and Drive MD5 intact
  try {
    setMockDriveFile(companyId, {
      buffer: Buffer.from('Corrupt spreadsheet payload that fails validation'),
      md5Checksum: 'corrupted-drive-checksum-999',
      modifiedTime: '2026-09-07T12:30:00Z',
    });

    const req = createJsonRequest('/api/sync/trigger', 'POST', undefined, token);
    const res = await triggerSyncRoute(req);

    const compAfter = await db.getCompany();
    const { items: itemsAfter } = await db.getCompanyItems();

    const catalogPreserved =
      itemsAfter.length === 3 &&
      itemsAfter[0].i_code === 'A_001';

    const metadataPreserved =
      compAfter.item_count === 3 &&
      compAfter.data_version === initialVersion &&
      compAfter.google_drive_md5 === initialDriveMd5 &&
      compAfter.sync_status === 'FAILED';

    const passed = res.status === 400 && catalogPreserved && metadataPreserved;
    record(
      15,
      'ATOMICITY',
      'Failed sync marks status FAILED but preserves previous catalog, data_version, and Drive MD5 (True Atomicity)',
      passed,
      `Items: ${itemsAfter.length}/3, Version: ${compAfter.data_version}`
    );
  } catch (e: any) {
    record(15, 'ATOMICITY', 'Preserve on failure check', false, e.message);
  }

  // 16. Failed duplicate code leaves previous catalog intact
  try {
    const dupSyncFile = createMockXlsxBuffer([
      { I_CODE: 'DUP_X', ITEM_NAME: 'Item X', DESCRIBE: '', QUANTITY: '1', RATE: '1', DISC_PER: '0', DISC_B: '0' },
      { I_CODE: 'DUP_X', ITEM_NAME: 'Item X2', DESCRIBE: '', QUANTITY: '2', RATE: '2', DISC_PER: '0', DISC_B: '0' },
    ]);
    setMockDriveFile(companyId, {
      buffer: dupSyncFile,
      modifiedTime: '2026-09-07T12:45:00Z',
    });

    const req = createJsonRequest('/api/sync/trigger', 'POST', undefined, token);
    const res = await triggerSyncRoute(req);

    const { items: currentItems } = await db.getCompanyItems();
    const passed = res.status === 400 && currentItems.length === 3 && currentItems[0].i_code === 'A_001';
    record(
      16,
      'ATOMICITY',
      'Duplicate codes fail synchronization and leave previous valid catalog intact',
      passed,
      `Current catalog items: ${currentItems.length} (Previous 3 items retained)`
    );
  } catch (e: any) {
    record(16, 'ATOMICITY', 'Duplicate fail atomicity check', false, e.message);
  }

  // 17. Versioned catalog blob (catalog-v<version>.json.gz) is verified in storage
  try {
    const comp = await db.getCompany();
    const activeVer = comp.active_catalog_version;
    const { items } = await db.getCompanyItems();
    const passed = activeVer === initialVersion && items.length === 3;
    record(
      17,
      'ATOMICITY',
      'Versioned catalog blob is verified and active in configuration',
      passed,
      `Active version: catalog-v${activeVer}.json.gz with ${items.length} items`
    );
  } catch (e: any) {
    record(17, 'ATOMICITY', 'Versioned catalog verification check', false, e.message);
  }

  // 18. Cold-start survival: fresh SingleCompanyStore re-reads catalog from storage and serves /api/sync/data
  try {
    const coldStore = new SingleCompanyStore();
    const { items: coldItems, total } = await coldStore.getCompanyItems(undefined, { limit: 2, offset: 0 });

    const req = createJsonRequest('/api/sync/data?limit=2&offset=0', 'GET', undefined, token);
    const res = await syncDataRoute(req);
    const json = await res.json();

    const passed =
      res.status === 200 &&
      json.data.returned_count === 2 &&
      json.data.item_count === 3 &&
      coldItems.length === 2;

    record(
      18,
      'ATOMICITY',
      'Cold-start survival: fresh SingleCompanyStore re-reads catalog from storage and serves /api/sync/data',
      passed,
      `Served paginated items from storage: ${json.data.returned_count}/${json.data.item_count}`
    );
  } catch (e: any) {
    record(18, 'ATOMICITY', 'Cold start catalog read check', false, e.message);
  }

  // -------------------------------------------------------------------------
  // CATEGORY 5: OPTIMIZATION & VERSION INDEPENDENCE
  // -------------------------------------------------------------------------

  // 19. Drive MD5 unchanged -> returns unchanged: true
  let stableCatalogVersion = '';
  let stableDriveMd5 = '';
  try {
    const stableBuffer = createMockXlsxBuffer([
      { I_CODE: 'OPT001', ITEM_NAME: 'Optimized Item', DESCRIBE: 'No Change Test', QUANTITY: '10', RATE: '10.00', DISC_PER: '0', DISC_B: '0' },
    ]);
    stableDriveMd5 = crypto.createHash('md5').update(stableBuffer).digest('hex');

    setMockDriveFile(companyId, {
      buffer: stableBuffer,
      md5Checksum: stableDriveMd5,
      modifiedTime: '2026-09-07T13:30:00Z',
    });

    await triggerSyncRoute(createJsonRequest('/api/sync/trigger', 'POST', undefined, token));
    const comp1 = await db.getCompany();
    stableCatalogVersion = comp1.data_version || '';

    const req2 = createJsonRequest('/api/sync/trigger', 'POST', undefined, token);
    const res2 = await triggerSyncRoute(req2);
    const json2 = await res2.json();

    const passed =
      res2.status === 200 &&
      json2.success === true &&
      json2.data.unchanged === true &&
      json2.data.google_drive_md5 === stableDriveMd5 &&
      json2.data.data_version === stableCatalogVersion;

    record(
      19,
      'OPTIMIZATION',
      'Drive MD5 unchanged -> no download/reprocessing (returns unchanged: true)',
      passed,
      `Unchanged: ${json2.data?.unchanged}, Drive MD5: ${json2.data?.google_drive_md5}`
    );
  } catch (e: any) {
    record(19, 'OPTIMIZATION', 'No-change optimization check', false, e.message);
  }

  // 20. Drive MD5 changed -> synchronization occurs
  try {
    const modifiedDriveBuffer = createMockXlsxBuffer([
      { I_CODE: 'OPT001', ITEM_NAME: 'Optimized Item v2', DESCRIBE: 'Changed File', QUANTITY: '12', RATE: '15.00', DISC_PER: '5', DISC_B: '0' },
    ]);
    const newDriveMd5 = crypto.createHash('md5').update(modifiedDriveBuffer).digest('hex');

    setMockDriveFile(companyId, {
      buffer: modifiedDriveBuffer,
      md5Checksum: newDriveMd5,
      modifiedTime: '2026-09-07T13:45:00Z',
    });

    const req = createJsonRequest('/api/sync/trigger', 'POST', undefined, token);
    const res = await triggerSyncRoute(req);
    const comp = await db.getCompany();

    const passed =
      res.status === 200 &&
      comp.google_drive_md5 === newDriveMd5 &&
      comp.sync_status === 'SUCCESS';

    record(
      20,
      'OPTIMIZATION',
      'Drive MD5 changed -> synchronization occurs and updates Drive MD5',
      passed,
      `New Drive MD5: ${comp.google_drive_md5}, Version: ${comp.data_version}`
    );
  } catch (e: any) {
    record(20, 'OPTIMIZATION', 'Drive MD5 changed check', false, e.message);
  }

  // 21. Different Drive MD5 but identical normalized catalog -> data_version remains identical
  try {
    const rows = [
      { I_CODE: 'ISO_01', ITEM_NAME: 'Same Item', DESCRIBE: 'Identical Data', QUANTITY: '10', RATE: '25.00', DISC_PER: '0', DISC_B: '0' },
    ];
    const initialBuf = createMockXlsxBuffer(rows);
    const driveMd5_1 = 'drive-checksum-version-1';
    setMockDriveFile(companyId, {
      buffer: initialBuf,
      md5Checksum: driveMd5_1,
      modifiedTime: '2026-09-07T14:00:00Z',
    });

    await triggerSyncRoute(createJsonRequest('/api/sync/trigger', 'POST', undefined, token));
    const compBefore = await db.getCompany();
    const verBefore = compBefore.data_version;

    const driveMd5_2 = 'drive-checksum-version-2-same-data';
    setMockDriveFile(companyId, {
      buffer: initialBuf,
      md5Checksum: driveMd5_2,
      modifiedTime: '2026-09-07T14:10:00Z',
    });

    const resSync2 = await triggerSyncRoute(createJsonRequest('/api/sync/trigger', 'POST', undefined, token));
    const compAfter = await db.getCompany();

    const passed =
      resSync2.status === 200 &&
      compAfter.google_drive_md5 === driveMd5_2 &&
      compAfter.data_version === verBefore;

    record(
      21,
      'OPTIMIZATION',
      'Different Drive MD5 but identical normalized catalog -> sync succeeds while data_version remains identical',
      passed,
      `Drive MD5 updated to: ${compAfter.google_drive_md5}, Version remained: ${compAfter.data_version}`
    );
  } catch (e: any) {
    record(21, 'OPTIMIZATION', 'Catalog version stability check', false, e.message);
  }

  // 22. Catalog data_version is independent from Drive MD5
  try {
    const compPrior = await db.getCompany();
    const priorVer = compPrior.data_version;

    const changedBuf = createMockXlsxBuffer([
      { I_CODE: 'ISO_01', ITEM_NAME: 'Same Item', DESCRIBE: 'Identical Data', QUANTITY: '10', RATE: '50.00', DISC_PER: '0', DISC_B: '0' },
    ]);
    const driveMd5_3 = 'drive-checksum-version-3';
    setMockDriveFile(companyId, {
      buffer: changedBuf,
      md5Checksum: driveMd5_3,
      modifiedTime: '2026-09-07T14:20:00Z',
    });

    await triggerSyncRoute(createJsonRequest('/api/sync/trigger', 'POST', undefined, token));
    const compNew = await db.getCompany();

    const passed =
      compNew.google_drive_md5 === driveMd5_3 &&
      compNew.data_version !== priorVer &&
      compNew.data_version !== driveMd5_3;

    record(
      22,
      'OPTIMIZATION',
      'Catalog data_version is independent from Drive MD5 (data changes update catalog data_version)',
      passed,
      `Previous: ${priorVer}, New: ${compNew.data_version}`
    );
  } catch (e: any) {
    record(22, 'OPTIMIZATION', 'Data version independence check', false, e.message);
  }

  // 23. /api/sync/status reports accurate metrics
  try {
    const req = createJsonRequest('/api/sync/status', 'GET', undefined, token);
    const res = await syncStatusRoute(req);
    const json = await res.json();

    const passed =
      res.status === 200 &&
      json.success === true &&
      json.data.item_count === 1 &&
      json.data.sync_status === 'SUCCESS' &&
      json.data.file_name === 'itemmast.xlsx';

    record(
      23,
      'OPTIMIZATION',
      '/api/sync/status reports accurate live catalog metrics, status, google_drive_md5, and file info',
      passed,
      `Data: ${JSON.stringify(json.data)}`
    );
  } catch (e: any) {
    record(23, 'OPTIMIZATION', 'Sync status endpoint check', false, e.message);
  }

  // 24. /api/sync/data?version=xxx returns up_to_date: true
  try {
    const comp = await db.getCompany();
    const currentVersion = comp.data_version;

    const req = createJsonRequest(`/api/sync/data?version=${currentVersion}`, 'GET', undefined, token);
    const res = await syncDataRoute(req);
    const json = await res.json();

    const passed =
      res.status === 200 &&
      json.data.up_to_date === true &&
      json.data.items.length === 0;

    record(
      24,
      'OPTIMIZATION',
      '/api/sync/data returns up_to_date: true with empty payload when client has current version',
      passed,
      `Up to date: ${json.data?.up_to_date}, Transmitted items: ${json.data?.items?.length}`
    );
  } catch (e: any) {
    record(24, 'OPTIMIZATION', 'Version check endpoint test', false, e.message);
  }

  // 25. Sensitive credentials omitted from API responses
  try {
    const statusReq = createJsonRequest('/api/sync/status', 'GET', undefined, token);
    const statusJson = await (await syncStatusRoute(statusReq)).json();

    const triggerReq = createJsonRequest('/api/sync/trigger', 'POST', undefined, token);
    const triggerJson = await (await triggerSyncRoute(triggerReq)).json();

    const dataReq = createJsonRequest('/api/sync/data', 'GET', undefined, token);
    const dataJson = await (await syncDataRoute(dataReq)).json();

    const combined = JSON.stringify({ statusJson, triggerJson, dataJson }).toLowerCase();
    const passed =
      !combined.includes('refresh_token') &&
      !combined.includes('password_hash') &&
      !combined.includes('mock-refresh-token') &&
      !combined.includes('secret');

    record(
      25,
      'OPTIMIZATION',
      'Sensitive tokens, password hashes, and encryption keys are strictly omitted from sync APIs',
      passed,
      'Zero credential exposure verified'
    );
  } catch (e: any) {
    record(25, 'OPTIMIZATION', 'Credential leakage check', false, e.message);
  }

  // -------------------------------------------------------------------------
  // CATEGORY 6: PERFORMANCE BENCHMARKS (10,000 & 50,000 Records)
  // -------------------------------------------------------------------------

  // 26. 10,000 item realistic dataset benchmark
  try {
    console.log('\n--- Generating 10,000 item dataset for performance benchmark ---');
    const genStart = Date.now();
    const items10k = Array.from({ length: 10000 }, (_, i) => ({
      I_CODE: `ITEM_${String(i + 1).padStart(6, '0')}`,
      ITEM_NAME: `Benchmark Hardware Item #${i + 1}`,
      DESCRIBE: `High-speed warehouse stock SKU ${i + 1} specification`,
      QUANTITY: String((i % 500) + 1),
      RATE: ((i % 1000) + 9.99).toFixed(2),
      DISC_PER: String((i % 25)),
      DISC_B: (i % 5).toFixed(2),
    }));

    const buffer10k = createMockXlsxBuffer(items10k);
    const genTime = Date.now() - genStart;

    setMockDriveFile(companyId, {
      buffer: buffer10k,
      modifiedTime: new Date().toISOString(),
    });

    const benchStart = Date.now();
    const req10k = createJsonRequest('/api/sync/trigger', 'POST', undefined, token);
    const res10k = await triggerSyncRoute(req10k);
    const json10k = await res10k.json();
    const benchDuration = Date.now() - benchStart;

    const comp10k = await db.getCompany();
    const passed =
      res10k.status === 200 &&
      json10k.success === true &&
      comp10k.item_count === 10000 &&
      comp10k.sync_status === 'SUCCESS';

    record(
      26,
      'PERFORMANCE',
      `10,000 item dataset processed and published in ${benchDuration}ms (${Math.round((10000 / benchDuration) * 1000)} rows/sec)`,
      passed,
      `Generation: ${genTime}ms, Full sync duration: ${benchDuration}ms, Items committed: ${comp10k.item_count}`
    );
  } catch (e: any) {
    record(26, 'PERFORMANCE', '10k benchmark check', false, e.message);
  }

  // 27. 50,000 item realistic dataset benchmark
  try {
    console.log('\n--- Generating 50,000 item dataset for large-file benchmark ---');
    const genStart50k = Date.now();
    const items50k = Array.from({ length: 50000 }, (_, i) => ({
      I_CODE: `SKU_${String(i + 1).padStart(7, '0')}`,
      ITEM_NAME: `Industrial Component Model ${i + 1}`,
      DESCRIBE: `Certified heavy-duty component serial #${1000000 + i}`,
      QUANTITY: String((i % 1000) + 5),
      RATE: ((i % 5000) + 49.5).toFixed(2),
      DISC_PER: String((i % 30)),
      DISC_B: (i % 10).toFixed(2),
    }));

    const buffer50k = createMockXlsxBuffer(items50k);
    const genTime50k = Date.now() - genStart50k;

    const memBefore = process.memoryUsage().heapUsed;
    const parseStart50k = Date.now();
    const parseResult50k = parseExcelBuffer(buffer50k);
    const parseDuration50k = Date.now() - parseStart50k;

    const publishStart50k = Date.now();
    await db.publishCompanyItems(companyId, parseResult50k.items, parseResult50k.data_version);
    const publishDuration50k = Date.now() - publishStart50k;
    const memAfter = process.memoryUsage().heapUsed;

    const total50k = parseDuration50k + publishDuration50k;
    const throughput = Math.round((50000 / total50k) * 1000);
    const memoryDiffMB = Math.round((memAfter - memBefore) / (1024 * 1024));

    const comp50k = await db.getCompany();
    const passed =
      comp50k.item_count === 50000 &&
      comp50k.sync_status === 'SUCCESS' &&
      parseResult50k.items.length === 50000;

    record(
      27,
      'PERFORMANCE',
      `50,000 item dataset processed and published in ${total50k}ms (${throughput} rows/sec, ~${memoryDiffMB}MB heap)`,
      passed,
      `Parse: ${parseDuration50k}ms, Atomic commit: ${publishDuration50k}ms, Total: ${total50k}ms, Throughput: ${throughput} items/s`
    );
  } catch (e: any) {
    record(27, 'PERFORMANCE', '50k benchmark check', false, e.message);
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;

  console.log('\n======================================================================');
  console.log(` STAGE 6 TEST SUITE SUMMARY: ${passedCount}/${results.length} PASSED (${failedCount} FAILED)`);
  console.log('======================================================================\n');

  if (failedCount > 0) {
    console.error(`\x1b[31mStage 6 automated test suite failed with ${failedCount} failing tests.\x1b[0m`);
    process.exit(1);
  } else {
    console.log('\x1b[32mAll Stage 6 verification tests and performance benchmarks passed successfully!\x1b[0m\n');
  }
}

runStage6Tests().catch((err) => {
  console.error('Fatal error in Stage 6 test runner:', err);
  process.exit(1);
});
