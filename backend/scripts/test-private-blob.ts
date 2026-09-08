import assert from 'assert';
import zlib from 'zlib';
import { MockAgent, setGlobalDispatcher } from 'undici';
import { VercelBlobStorage, LocalFileStorage } from '../src/lib/storage';

async function runTests() {
  console.log('======================================================================');
  console.log('       TESTING VERCEL BLOB STORAGE ADAPTER WITH PRIVATE ACCESS       ');
  console.log('======================================================================\n');

  // Set up token in standard format: vercel_blob_rw_<storeId>_<secret>
  const storeId = 'mystore123';
  const testToken = `vercel_blob_rw_${storeId}_secret456789`;
  process.env.BLOB_READ_WRITE_TOKEN = testToken;

  // Set up undici MockAgent
  const mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);

  // In-memory store for our mock Vercel Blob backend
  const inMemoryBlobStore = new Map<string, { body: Buffer; contentType: string }>();

  // Mock API client for vercel.com/api/blob (put, del, etc.)
  const apiPool = mockAgent.get('https://vercel.com');

  // Intercept PUT requests (put calls /api/blob/?pathname=...)
  apiPool.intercept({
    path: (pathStr: string) => pathStr.startsWith('/api/blob') && !pathStr.includes('/delete'),
    method: 'PUT',
  }).defaultReplyHeaders({ 'content-type': 'application/json' })
    .reply((options) => {
      // 1. Verify access header is strictly 'private'
      const headers = options.headers as Record<string, string>;
      const access = headers['x-vercel-blob-access'];
      if (access !== 'private') {
        return {
          statusCode: 400,
          data: JSON.stringify({ error: { code: 'bad_request', message: `Cannot use public access on a private store: got '${access}'` } }),
        };
      }

      // Extract pathname from query string
      const url = new URL(`https://vercel.com${options.path}`);
      const pathname = url.searchParams.get('pathname') || '';
      const contentType = headers['x-content-type'] || 'application/octet-stream';

      let bodyBuffer: Buffer;
      if (Buffer.isBuffer(options.body)) {
        bodyBuffer = options.body;
      } else if (options.body instanceof Uint8Array) {
        bodyBuffer = Buffer.from(options.body);
      } else if (typeof options.body === 'string') {
        bodyBuffer = Buffer.from(options.body);
      } else {
        bodyBuffer = Buffer.from('');
      }

      inMemoryBlobStore.set(pathname, { body: bodyBuffer, contentType });

      const fakeUrl = `https://${storeId}.private.blob.vercel-storage.com/${pathname}`;
      return {
        statusCode: 200,
        data: JSON.stringify({
          url: fakeUrl,
          downloadUrl: `${fakeUrl}?download=1`,
          pathname,
          contentType,
          contentDisposition: 'inline',
          etag: '"test-etag-1"',
        }),
      };
    }).persist();

  // Intercept DELETE requests (del calls POST /api/blob/delete)
  apiPool.intercept({
    path: (pathStr: string) => pathStr.startsWith('/api/blob/delete'),
    method: 'POST',
  }).defaultReplyHeaders({ 'content-type': 'application/json' })
    .reply((options) => {
      const body = JSON.parse(options.body as string);
      for (const u of body.urls) {
        // can be pathname or full url
        const pathname = u.replace(new RegExp(`^https://${storeId}\\.private\\.blob\\.vercel-storage\\.com/`), '');
        inMemoryBlobStore.delete(pathname);
      }
      return { statusCode: 200, data: JSON.stringify({}) };
    }).persist();

  // Mock pool for blob download host: https://<storeId>.private.blob.vercel-storage.com
  const blobHostPool = mockAgent.get(`https://${storeId}.private.blob.vercel-storage.com`);

  // Intercept GET requests for blobs
  blobHostPool.intercept({
    path: () => true,
    method: 'GET',
  }).reply((options) => {
    // 1. Verify authorization header is present
    const headers = options.headers as Record<string, string>;
    const authHeader = headers['authorization'] || headers['Authorization'];
    if (authHeader !== `Bearer ${testToken}`) {
      return {
        statusCode: 403,
        data: 'Forbidden: Missing or invalid token',
      };
    }

    const url = new URL(`https://${storeId}.private.blob.vercel-storage.com${options.path}`);
    const pathname = url.pathname.slice(1); // remove leading slash
    const item = inMemoryBlobStore.get(pathname);

    if (!item) {
      return {
        statusCode: 404,
        data: 'Not Found',
      };
    }

    // Verify cache bypass parameter for private blobs
    assert.strictEqual(url.searchParams.get('cache'), '0', 'Private blob reads must bypass CDN cache (cache=0)');

    return {
      statusCode: 200,
      data: item.body,
      responseOptions: {
        headers: {
          'content-type': item.contentType,
          'content-length': String(item.body.length),
          'etag': '"test-etag-1"',
          'last-modified': new Date().toUTCString(),
        },
      },
    };
  }).persist();

  const storage = new VercelBlobStorage();

  // ====================================================================
  // TEST 1: writeConfig to private store
  // ====================================================================
  console.log('[TEST 1] writeConfig saves configuration with access: private');
  const sampleConfig: any = {
    id: 'comp_single',
    company_name: 'Production Company Inc',
    username: 'admin',
    password_hash: '$2a$10$abcdefghijklmnopqrstuvwxyz0123456789',
    status: 'ACTIVE',
    google_drive_folder_id: 'folder_xyz',
    google_drive_file_id: 'file_abc',
    google_drive_file_name: 'ITEMMAST.XLSX',
    google_drive_md5: 'md5_1234567890abcdef',
    google_drive_modified_time: new Date('2026-09-08T12:00:00Z'),
    google_refresh_token: null,
    active_catalog_version: 'ver_998877',
    last_sync_at: new Date('2026-09-08T12:30:00Z'),
    sync_status: 'SUCCESS',
    sync_error: null,
    data_version: 'ver_998877',
    item_count: 42,
    created_at: new Date('2026-09-01T00:00:00Z'),
    updated_at: new Date('2026-09-08T12:30:00Z'),
  };

  await storage.writeConfig(sampleConfig);
  assert(inMemoryBlobStore.has('company-config.json'), 'company-config.json must be stored');
  console.log('  -> PASS: writeConfig successfully wrote company-config.json to private store');

  // ====================================================================
  // TEST 2: readConfig from private store
  // ====================================================================
  console.log('[TEST 2] readConfig reads back config with authenticated get()');
  const readBackConfig = await storage.readConfig();
  assert(readBackConfig !== null, 'readConfig must not return null');
  assert.strictEqual(readBackConfig.id, 'comp_single');
  assert.strictEqual(readBackConfig.company_name, 'Production Company Inc');
  assert.strictEqual(readBackConfig.item_count, 42);
  assert(readBackConfig.google_drive_modified_time instanceof Date, 'google_drive_modified_time must be Date');
  assert(readBackConfig.last_sync_at instanceof Date, 'last_sync_at must be Date');
  assert.strictEqual(readBackConfig.last_sync_at.toISOString(), '2026-09-08T12:30:00.000Z');
  console.log('  -> PASS: readConfig fetched private blob with token authentication and revived dates');

  // ====================================================================
  // TEST 3: writeCatalog with gzip compression to private store
  // ====================================================================
  console.log('[TEST 3] writeCatalog compresses and writes versioned catalog');
  const sampleCatalog: any = {
    data_version: 'ver_998877',
    items: [
      { i_code: 'ITEM01', item_name: 'Paracetamol 500mg', describe: 'Pain relief', quantity: 100, rate: 2.5, disc_per: 0, disc_b: 0 },
      { i_code: 'ITEM02', item_name: 'Amoxicillin 250mg', describe: 'Antibiotic', quantity: 50, rate: 8.0, disc_per: 10, disc_b: 0 },
    ],
    created_at: '2026-09-08T12:30:00Z',
  };

  await storage.writeCatalog('ver_998877', sampleCatalog);
  assert(inMemoryBlobStore.has('catalog-vver_998877.json.gz'), 'catalog-vver_998877.json.gz must be stored');
  const rawCatalogEntry = inMemoryBlobStore.get('catalog-vver_998877.json.gz')!;
  assert.strictEqual(rawCatalogEntry.contentType, 'application/gzip');
  console.log('  -> PASS: writeCatalog wrote catalog-vver_998877.json.gz with access: private');

  // ====================================================================
  // TEST 4: readCatalog decompresses private blob
  // ====================================================================
  console.log('[TEST 4] readCatalog reads and decompresses private catalog stream');
  const readBackCatalog = await storage.readCatalog('ver_998877');
  assert(readBackCatalog !== null, 'readCatalog must not return null');
  assert.strictEqual(readBackCatalog.data_version, 'ver_998877');
  assert.strictEqual(readBackCatalog.items.length, 2);
  assert.strictEqual(readBackCatalog.items[0].i_code, 'ITEM01');
  assert.strictEqual(readBackCatalog.items[1].rate, 8.0);
  console.log('  -> PASS: readCatalog decompressed gzipped private blob stream accurately');

  // ====================================================================
  // TEST 5: deleteCatalog removes catalog blob
  // ====================================================================
  console.log('[TEST 5] deleteCatalog deletes catalog from private store');
  await storage.deleteCatalog('ver_998877');
  assert(!inMemoryBlobStore.has('catalog-vver_998877.json.gz'), 'catalog-vver_998877.json.gz must be deleted');
  const catalogAfterDelete = await storage.readCatalog('ver_998877');
  assert.strictEqual(catalogAfterDelete, null, 'Deleted catalog must return null on read');
  console.log('  -> PASS: deleteCatalog deleted blob and subsequent read returned null');

  // ====================================================================
  // TEST 6: Missing blob returns null without error
  // ====================================================================
  console.log('[TEST 6] Missing blob returns null gracefully');
  const missingCatalog = await storage.readCatalog('non_existent');
  assert.strictEqual(missingCatalog, null);
  console.log('  -> PASS: 404 handled gracefully returning null');

  // ====================================================================
  // TEST 7: LocalFileStorage behavior remains intact
  // ====================================================================
  console.log('[TEST 7] LocalFileStorage functions identically');
  const local = new LocalFileStorage();
  await local.writeConfig(sampleConfig);
  const localConfig = await local.readConfig();
  assert(localConfig !== null);
  assert.strictEqual(localConfig.company_name, sampleConfig.company_name);
  console.log('  -> PASS: LocalFileStorage unchanged and working');

  console.log('\n======================================================================');
  console.log(' ALL 7 VERCEL BLOB PRIVATE STORAGE TESTS PASSED SUCCESSFULLY!         ');
  console.log('======================================================================\n');
}

runTests().catch((err) => {
  console.error('Test failure:', err);
  process.exit(1);
});
