import assert from 'assert';
import bcrypt from 'bcryptjs';
import { SingleCompanyStore, isValidBcryptHash } from '../src/lib/db';
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
  console.log('       TESTING VERSIONED CREDENTIAL BOOTSTRAP & RESET MECHANISM       ');
  console.log('======================================================================\n');

  // Pre-compute test hashes
  const initialPass = 'initialPass123!';
  const initialHash = await bcrypt.hash(initialPass, 10);
  const updatedPass = 'updatedPass456!';
  const updatedHash = await bcrypt.hash(updatedPass, 10);
  const uiPass = 'uiChangedPass789!';
  const uiHash = await bcrypt.hash(uiPass, 10);

  // Test bcrypt validator
  assert.strictEqual(isValidBcryptHash(initialHash), true, 'Valid bcrypt hash must pass validation');
  assert.strictEqual(isValidBcryptHash('plainTextPassword'), false, 'Plaintext password must fail validation');
  assert.strictEqual(isValidBcryptHash(''), false, 'Empty string must fail validation');
  assert.strictEqual(isValidBcryptHash(null), false, 'Null must fail validation');
  assert.strictEqual(isValidBcryptHash(undefined), false, 'Undefined must fail validation');
  console.log('[PASS] Bcrypt validator correctly distinguishes valid hashes from plain text');

  // ------------------------------------------------------------------
  // TEST 1: New installation initializes cleanly
  // ------------------------------------------------------------------
  console.log('\n[TEST 1] New installation with no existing config initializes correctly');
  const mockStorage = new MockStorage();
  setStorageAdapter(mockStorage);

  process.env.ADMIN_USERNAME = 'initialAdmin';
  process.env.ADMIN_PASSWORD_HASH = initialHash;
  process.env.ADMIN_CREDENTIALS_VERSION = 'v1';

  let store = new SingleCompanyStore();
  let company = await store.getCompany();

  assert.strictEqual(company.username, 'initialAdmin');
  assert.strictEqual(company.password_hash, initialHash);
  assert.strictEqual(company.admin_credentials_version, 'v1');
  assert.strictEqual(company.status, 'ACTIVE');
  console.log('  -> PASS: Initial company created with username, bcrypt hash, and version v1');

  // ------------------------------------------------------------------
  // TEST 2: Existing config + no version change -> credentials unchanged
  // ------------------------------------------------------------------
  console.log('\n[TEST 2] Existing config with no credential version change keeps credentials unchanged');
  // Attempt to supply different env variables without changing ADMIN_CREDENTIALS_VERSION
  process.env.ADMIN_USERNAME = 'sneakyHacker';
  process.env.ADMIN_PASSWORD_HASH = updatedHash;
  // ADMIN_CREDENTIALS_VERSION remains 'v1'

  store = new SingleCompanyStore(); // fresh store instance (simulates serverless cold-start)
  company = await store.getCompany();

  assert.strictEqual(company.username, 'initialAdmin', 'Username must NOT change when version is unchanged');
  assert.strictEqual(company.password_hash, initialHash, 'Password hash must NOT change when version is unchanged');
  assert.strictEqual(company.admin_credentials_version, 'v1');
  console.log('  -> PASS: Credentials remained protected from env overrides when version did not change');

  // ------------------------------------------------------------------
  // TEST 3: Existing config + new credential version -> credentials updated
  // ------------------------------------------------------------------
  console.log('\n[TEST 3] Existing config with new credential version updates username and password');
  // Set existing Google Drive and catalog fields to ensure they are preserved
  company.google_drive_folder_id = 'folder_abc';
  company.google_drive_file_id = 'file_xyz';
  company.google_drive_file_name = 'ITEMMAST.XLSX';
  company.google_drive_md5 = 'md5_preserved_123';
  company.data_version = 'v_cat_123';
  company.item_count = 500;
  company.sync_status = 'SUCCESS';
  await mockStorage.writeConfig(company);

  process.env.ADMIN_USERNAME = 'newProductionAdmin';
  process.env.ADMIN_PASSWORD_HASH = updatedHash;
  process.env.ADMIN_CREDENTIALS_VERSION = 'v2'; // Bump version!

  store = new SingleCompanyStore();
  company = await store.getCompany();

  assert.strictEqual(company.username, 'newProductionAdmin', 'Username must update on version bump');
  assert.strictEqual(company.password_hash, updatedHash, 'Password hash must update on version bump');
  assert.strictEqual(company.admin_credentials_version, 'v2', 'Persisted version must be updated to v2');

  // Verify non-credential fields are strictly preserved
  assert.strictEqual(company.google_drive_folder_id, 'folder_abc', 'Drive folder ID must be preserved');
  assert.strictEqual(company.google_drive_file_id, 'file_xyz', 'Drive file ID must be preserved');
  assert.strictEqual(company.google_drive_file_name, 'ITEMMAST.XLSX', 'Drive file name must be preserved');
  assert.strictEqual(company.google_drive_md5, 'md5_preserved_123', 'Drive MD5 must be preserved');
  assert.strictEqual(company.data_version, 'v_cat_123', 'Catalog data_version must be preserved');
  assert.strictEqual(company.item_count, 500, 'Item count must be preserved');
  assert.strictEqual(company.sync_status, 'SUCCESS', 'Sync status must be preserved');
  console.log('  -> PASS: Credentials updated to v2 while all Drive/sync state was preserved');

  // ------------------------------------------------------------------
  // TEST 4: Existing config + same credential version -> no repeated update
  // ------------------------------------------------------------------
  console.log('\n[TEST 4] Existing config with same credential version does not re-apply or overwrite');
  store = new SingleCompanyStore();
  const sameVersionCompany = await store.getCompany();
  assert.strictEqual(sameVersionCompany.username, 'newProductionAdmin');
  assert.strictEqual(sameVersionCompany.password_hash, updatedHash);
  assert.strictEqual(sameVersionCompany.admin_credentials_version, 'v2');
  console.log('  -> PASS: No redundant write/overwrite when version matches');

  // ------------------------------------------------------------------
  // TEST 5: UI password change via /admin/credentials persists & is not overwritten
  // ------------------------------------------------------------------
  console.log('\n[TEST 5] UI password change persists and is not overwritten by environment variables');
  await store.updateCompanyCredentials(company.id, {
    password_hash: uiHash,
    username: 'uiRenamedAdmin',
  });

  // Verify UI change is in storage
  let reloaded = await mockStorage.readConfig();
  assert.strictEqual(reloaded?.username, 'uiRenamedAdmin');
  assert.strictEqual(reloaded?.password_hash, uiHash);

  // Cold start with same ADMIN_CREDENTIALS_VERSION ('v2') still in process.env
  store = new SingleCompanyStore();
  const afterColdStart = await store.getCompany();
  assert.strictEqual(afterColdStart.username, 'uiRenamedAdmin', 'UI updated username must persist');
  assert.strictEqual(afterColdStart.password_hash, uiHash, 'UI updated password hash must persist');
  console.log('  -> PASS: Credentials updated via web panel persist and are not overwritten');

  // ------------------------------------------------------------------
  // TEST 6: Invalid / non-bcrypt ADMIN_PASSWORD_HASH is rejected
  // ------------------------------------------------------------------
  console.log('\n[TEST 6] Invalid non-bcrypt ADMIN_PASSWORD_HASH does not overwrite stored password');
  process.env.ADMIN_USERNAME = 'validAdmin3';
  process.env.ADMIN_PASSWORD_HASH = 'plainTextNotBcrypt'; // Invalid!
  process.env.ADMIN_CREDENTIALS_VERSION = 'v3'; // Version bumped, but hash is invalid

  store = new SingleCompanyStore();
  const afterInvalidAttempt = await store.getCompany();

  assert.strictEqual(afterInvalidAttempt.username, 'validAdmin3', 'Username should update');
  assert.strictEqual(afterInvalidAttempt.password_hash, uiHash, 'Password hash must NOT be overwritten with non-bcrypt string');
  assert.strictEqual(afterInvalidAttempt.admin_credentials_version, 'v3', 'Version advances so it does not retry endlessly');
  console.log('  -> PASS: Plain-text password in ADMIN_PASSWORD_HASH was safely rejected');

  // ------------------------------------------------------------------
  // TEST 7: Backward compatibility with legacy company-config.json
  // ------------------------------------------------------------------
  console.log('\n[TEST 7] Backward compatibility with legacy company-config.json without admin_credentials_version');
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

  // Case A: ADMIN_CREDENTIALS_VERSION is unset -> legacy credentials used as-is
  delete process.env.ADMIN_CREDENTIALS_VERSION;
  process.env.ADMIN_USERNAME = 'ignoredUser';
  process.env.ADMIN_PASSWORD_HASH = updatedHash;

  store = new SingleCompanyStore();
  let legacyResult = await store.getCompany();
  assert.strictEqual(legacyResult.username, 'legacyUser', 'Legacy username preserved when version unset');
  assert.strictEqual(legacyResult.password_hash, initialHash, 'Legacy password hash preserved when version unset');
  assert.strictEqual(legacyResult.admin_credentials_version, null, 'Defaulted to null for legacy config');

  // Case B: ADMIN_CREDENTIALS_VERSION is set -> triggers reset for legacy config
  process.env.ADMIN_CREDENTIALS_VERSION = 'v2026-09-08';
  process.env.ADMIN_USERNAME = 'modernizedAdmin';
  process.env.ADMIN_PASSWORD_HASH = updatedHash;

  store = new SingleCompanyStore();
  legacyResult = await store.getCompany();
  assert.strictEqual(legacyResult.username, 'modernizedAdmin', 'Legacy config successfully reset upon version definition');
  assert.strictEqual(legacyResult.password_hash, updatedHash, 'Legacy password hash updated to valid bcrypt hash');
  assert.strictEqual(legacyResult.admin_credentials_version, 'v2026-09-08');
  assert.strictEqual(legacyResult.google_drive_file_id, 'file_leg', 'Legacy Drive file ID preserved');
  console.log('  -> PASS: Legacy config loaded cleanly without error and reset cleanly when version defined');

  console.log('\n======================================================================');
  console.log(' ALL 7 VERSIONED CREDENTIAL BOOTSTRAP & RESET TESTS PASSED!          ');
  console.log('======================================================================\n');
}

runTests().catch((err) => {
  console.error('Test failure:', err);
  process.exit(1);
});
