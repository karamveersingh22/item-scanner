import assert from 'assert';
import bcrypt from 'bcryptjs';
import { SingleCompanyStore, isValidBcryptHash, normalizeBcryptHash } from '../src/lib/db';
import { StorageAdapter, setStorageAdapter } from '../src/lib/storage';
import { CompanyConfig, CatalogCache } from '../src/lib/types';

// In-memory mock storage adapter for deterministic unit testing
class MockStorage implements StorageAdapter {
  public config: CompanyConfig | null = null;
  public catalogs = new Map<string, CatalogCache>();

  async readConfig(): Promise<CompanyConfig | null> {
    return this.config ? JSON.parse(JSON.stringify(this.config)) : null;
  }

  async writeConfig(config: CompanyConfig): Promise<void> {
    this.config = JSON.parse(JSON.stringify(config));
  }

  async readCatalog(version: string): Promise<CatalogCache | null> {
    return this.catalogs.get(version) || null;
  }

  async writeCatalog(version: string, data: CatalogCache): Promise<void> {
    this.catalogs.set(version, JSON.parse(JSON.stringify(data)));
  }

  async deleteCatalog(version: string): Promise<void> {
    this.catalogs.delete(version);
  }

  async clearAll(): Promise<void> {
    this.config = null;
    this.catalogs.clear();
  }
}

async function runTests() {
  console.log('======================================================================');
  console.log('       TESTING ROBUST VERSIONED CREDENTIAL RESET & NORMALIZATION      ');
  console.log('======================================================================\n');

  // Pre-compute test hashes
  const initialPass = 'initialPass123!';
  const initialHash = await bcrypt.hash(initialPass, 10);
  const updatedPass = 'updatedPass456!';
  const updatedHash = await bcrypt.hash(updatedPass, 10);
  const uiPass = 'uiChangedPass789!';
  const uiHash = await bcrypt.hash(uiPass, 10);

  // ------------------------------------------------------------------
  // BCRYPT NORMALIZATION & VALIDATION TESTS
  // ------------------------------------------------------------------
  console.log('[UNIT TESTS] Bcrypt normalization & validation');

  // 1. Valid raw bcrypt hash
  assert.strictEqual(isValidBcryptHash(initialHash), true, 'Valid raw bcrypt hash must pass');
  assert.strictEqual(normalizeBcryptHash(initialHash), initialHash, 'Normalized raw hash equals raw hash');

  // 2. Valid bcrypt hash surrounded by double quotes
  const doubleQuoted = `"${initialHash}"`;
  assert.strictEqual(isValidBcryptHash(doubleQuoted), true, 'Double quoted bcrypt hash must pass');
  assert.strictEqual(normalizeBcryptHash(doubleQuoted), initialHash, 'Double quotes must be stripped');

  // 3. Valid bcrypt hash surrounded by single quotes
  const singleQuoted = `'${initialHash}'`;
  assert.strictEqual(isValidBcryptHash(singleQuoted), true, 'Single quoted bcrypt hash must pass');
  assert.strictEqual(normalizeBcryptHash(singleQuoted), initialHash, 'Single quotes must be stripped');

  // 4. Whitespace around hash
  const whitespaceHash = `  \t ${initialHash}   \n`;
  assert.strictEqual(isValidBcryptHash(whitespaceHash), true, 'Whitespace padded bcrypt hash must pass');
  assert.strictEqual(normalizeBcryptHash(whitespaceHash), initialHash, 'Whitespace must be trimmed');

  // 5. Invalid plaintext password
  assert.strictEqual(isValidBcryptHash('plainTextPassword123!'), false, 'Plaintext password must be rejected');

  // 6. Invalid hash (corrupted prefix, mismatched quotes, empty, null)
  assert.strictEqual(isValidBcryptHash('"$2b$10$tooshort"'), false, 'Malformed hash must be rejected');
  assert.strictEqual(isValidBcryptHash('$2z$10$' + initialHash.slice(7)), false, 'Unknown identifier $2z$ must be rejected');
  assert.strictEqual(isValidBcryptHash(''), false, 'Empty string must be rejected');
  assert.strictEqual(isValidBcryptHash(null), false, 'Null must be rejected');
  assert.strictEqual(isValidBcryptHash(undefined), false, 'Undefined must be rejected');

  console.log('  -> PASS: All 6 normalization and format validation checks passed');

  // Setup mock storage
  const mockStorage = new MockStorage();
  setStorageAdapter(mockStorage);

  // ------------------------------------------------------------------
  // TEST 1: New installation initializes cleanly
  // ------------------------------------------------------------------
  console.log('\n[TEST 1] New installation with no existing config initializes correctly');
  process.env.ADMIN_USERNAME = 'initialAdmin';
  process.env.ADMIN_PASSWORD_HASH = `"${initialHash}"`; // double-quoted in env
  process.env.ADMIN_CREDENTIALS_VERSION = 'v1';

  let store = new SingleCompanyStore();
  let company = await store.getCompany();

  assert.strictEqual(company.username, 'initialAdmin');
  assert.strictEqual(company.password_hash, initialHash, 'Hash must be normalized (quotes stripped)');
  assert.strictEqual(company.admin_credentials_version, 'v1');
  assert.strictEqual(company.status, 'ACTIVE');
  console.log('  -> PASS: Initial company created with normalized hash and version v1');

  // ------------------------------------------------------------------
  // TEST 2: Existing config + same credential version -> no unnecessary update
  // ------------------------------------------------------------------
  console.log('\n[TEST 2] Same credential version does not update or overwrite');
  process.env.ADMIN_USERNAME = 'shouldNotApply';
  process.env.ADMIN_PASSWORD_HASH = updatedHash;
  // ADMIN_CREDENTIALS_VERSION remains 'v1'

  store = new SingleCompanyStore();
  company = await store.getCompany();

  assert.strictEqual(company.username, 'initialAdmin', 'Username must NOT change when version is unchanged');
  assert.strictEqual(company.password_hash, initialHash, 'Password hash must NOT change when version is unchanged');
  assert.strictEqual(company.admin_credentials_version, 'v1');
  console.log('  -> PASS: Credentials protected from env override when version matches');

  // ------------------------------------------------------------------
  // TEST 3: Version mismatch + valid credentials => updated and version advanced
  // ------------------------------------------------------------------
  console.log('\n[TEST 3] Version mismatch + valid credentials updates credentials and advances version');
  // Set some Google Drive and catalog fields to ensure they are preserved
  company.google_drive_folder_id = 'folder_abc';
  company.google_drive_file_id = 'file_xyz';
  company.google_drive_file_name = 'ITEMMAST.XLSX';
  company.google_drive_md5 = 'md5_preserved_123';
  company.data_version = 'v_cat_123';
  company.item_count = 500;
  company.sync_status = 'SUCCESS';
  await mockStorage.writeConfig(company);

  process.env.ADMIN_USERNAME = 'updatedAdmin';
  process.env.ADMIN_PASSWORD_HASH = `'${updatedHash}'`; // single-quoted in env
  process.env.ADMIN_CREDENTIALS_VERSION = 'v2'; // Bump version!

  store = new SingleCompanyStore();
  company = await store.getCompany();

  assert.strictEqual(company.username, 'updatedAdmin', 'Username must update');
  assert.strictEqual(company.password_hash, updatedHash, 'Password hash must update to normalized hash');
  assert.strictEqual(company.admin_credentials_version, 'v2', 'Version must advance to v2');
  assert.strictEqual(company.google_drive_file_id, 'file_xyz', 'Google Drive file ID preserved');
  assert.strictEqual(company.data_version, 'v_cat_123', 'Catalog version preserved');
  console.log('  -> PASS: Version advanced to v2 with normalized password and preserved Drive state');

  // ------------------------------------------------------------------
  // TEST 4: Version mismatch + invalid hash => password unchanged, version NOT advanced
  // ------------------------------------------------------------------
  console.log('\n[TEST 4] Version mismatch + invalid hash => password unchanged and version NOT advanced');
  process.env.ADMIN_USERNAME = 'sneakyUsername';
  process.env.ADMIN_PASSWORD_HASH = 'plainTextNotBcrypt'; // Invalid!
  process.env.ADMIN_CREDENTIALS_VERSION = 'v3'; // Version bumped, but invalid hash

  store = new SingleCompanyStore();
  company = await store.getCompany();

  // Crucial invariant: Version must NOT advance, password must NOT change!
  assert.strictEqual(company.password_hash, updatedHash, 'Password hash must remain previous valid hash');
  assert.strictEqual(company.admin_credentials_version, 'v2', 'admin_credentials_version must NOT advance to v3');
  console.log('  -> PASS: Invalid hash rejected, password unchanged, and version was NOT prematurely advanced');

  // ------------------------------------------------------------------
  // TEST 5: Version mismatch + missing password hash => version NOT advanced
  // ------------------------------------------------------------------
  console.log('\n[TEST 5] Version mismatch + missing password hash => version NOT incorrectly advanced');
  delete process.env.ADMIN_PASSWORD_HASH; // Missing!
  process.env.ADMIN_CREDENTIALS_VERSION = 'v4';

  store = new SingleCompanyStore();
  company = await store.getCompany();

  assert.strictEqual(company.password_hash, updatedHash, 'Password hash must remain previous valid hash');
  assert.strictEqual(company.admin_credentials_version, 'v2', 'Version must remain v2');
  console.log('  -> PASS: Missing password hash prevented version advancement');

  // ------------------------------------------------------------------
  // TEST 6: Warm cache + newer environment version => synchronization occurs
  // ------------------------------------------------------------------
  console.log('\n[TEST 6] Warm cache + newer environment version invalidates cache and synchronizes');
  // Store instance currently holds in-memory cache at 'v2'
  assert.strictEqual((store as any).cachedConfig?.admin_credentials_version, 'v2');

  // Set new valid credentials and bump to v5 in environment
  const warmPass = 'warmPass999!';
  const warmHash = await bcrypt.hash(warmPass, 10);
  process.env.ADMIN_USERNAME = 'warmAdmin';
  process.env.ADMIN_PASSWORD_HASH = warmHash;
  process.env.ADMIN_CREDENTIALS_VERSION = 'v5';

  // Call getCompany() on the SAME store instance (simulating warm serverless invocation)
  const warmCompany = await store.getCompany();

  assert.strictEqual(warmCompany.username, 'warmAdmin', 'Username updated despite warm cache');
  assert.strictEqual(warmCompany.password_hash, warmHash, 'Password updated despite warm cache');
  assert.strictEqual(warmCompany.admin_credentials_version, 'v5', 'Version updated to v5 despite warm cache');
  console.log('  -> PASS: Warm serverless cache was successfully invalidated and synchronized');

  // ------------------------------------------------------------------
  // TEST 7: Legacy config with missing version => synchronization works
  // ------------------------------------------------------------------
  console.log('\n[TEST 7] Legacy config with null/missing version => synchronization works cleanly');
  const legacyConfig: any = {
    id: 'company-primary',
    company_name: 'Legacy Co',
    username: 'legacyUser',
    password_hash: initialHash,
    // Note: admin_credentials_version is missing (legacy)
    status: 'ACTIVE',
    google_drive_folder_id: 'folder_leg',
    google_drive_file_id: 'file_leg',
    google_drive_file_name: 'ITEMMAST.XLSX',
    google_drive_md5: 'md5_leg',
    google_drive_modified_time: null,
    google_refresh_token: null,
    active_catalog_version: null,
    data_version: 'leg_v1',
    item_count: 10,
    last_sync_at: null,
    sync_status: 'IDLE',
    sync_error: null,
    created_at: new Date(),
    updated_at: new Date(),
  };
  await mockStorage.writeConfig(legacyConfig);

  process.env.ADMIN_USERNAME = 'modernAdmin';
  process.env.ADMIN_PASSWORD_HASH = updatedHash;
  process.env.ADMIN_CREDENTIALS_VERSION = 'vLegacyReset';

  store = new SingleCompanyStore();
  const legacyResult = await store.getCompany();

  assert.strictEqual(legacyResult.username, 'modernAdmin');
  assert.strictEqual(legacyResult.password_hash, updatedHash);
  assert.strictEqual(legacyResult.admin_credentials_version, 'vLegacyReset');
  assert.strictEqual(legacyResult.google_drive_file_id, 'file_leg', 'Drive file preserved');
  console.log('  -> PASS: Legacy config without version was cleanly upgraded');

  // ------------------------------------------------------------------
  // TEST 8: UI password change is not overwritten when environment version hasn't changed
  // ------------------------------------------------------------------
  console.log('\n[TEST 8] UI password change is not overwritten when environment version has not changed');
  await store.updateCompanyCredentials(legacyResult.id, {
    username: 'uiAdmin',
    password_hash: uiHash,
  });

  // Verify in storage
  const fromStorage = await mockStorage.readConfig();
  assert.strictEqual(fromStorage?.username, 'uiAdmin');
  assert.strictEqual(fromStorage?.password_hash, uiHash);

  // Cold start with same process.env.ADMIN_CREDENTIALS_VERSION ('vLegacyReset')
  store = new SingleCompanyStore();
  const coldCompany = await store.getCompany();

  assert.strictEqual(coldCompany.username, 'uiAdmin');
  assert.strictEqual(coldCompany.password_hash, uiHash);
  console.log('  -> PASS: UI password change remains intact and is not overwritten by environment variables');

  console.log('\n======================================================================');
  console.log(' ALL 8 TEST SUITES (13 TOTAL VALIDATIONS) PASSED SUCCESSFULLY!       ');
  console.log('======================================================================\n');
}

runTests().catch((err) => {
  console.error('Test failure:', err);
  process.exit(1);
});
