import { CompanyConfig, CompanyStatus, SyncStatus, CatalogItem, CatalogCache } from './types';
import { getStorage } from './storage';

export interface UpdateProfileData {
  company_name?: string;
}

export interface UpdateCredentialsData {
  username?: string;
  password_hash?: string;
}

export interface UpdateSyncStateData {
  google_drive_folder_id?: string | null;
  google_drive_file_id?: string | null;
  google_drive_file_name?: string | null;
  google_drive_md5?: string | null;
  google_drive_modified_time?: Date | null;
  google_refresh_token?: string | null;
  active_catalog_version?: string | null;
  sync_status?: SyncStatus;
  sync_error?: string | null;
  last_sync_at?: Date | null;
  data_version?: string | null;
  item_count?: number;
}

const DEFAULT_COMPANY_ID = 'company-primary';
const DEFAULT_PASSWORD_HASH =
  process.env.ADMIN_PASSWORD_HASH ||
  '$2b$12$wjjDrxAK3N9nY86.kF8/PuLWmM393hgEPznV.Vp7tejFlE.JoocG.'; // bcrypt for 'admin123!'

/**
 * Single Company Store (Permanent One-Company Serverless Architecture)
 * Backed by StorageAdapter (private Vercel Blob in production, local files in dev/test)
 * with an in-memory cache layer for warm serverless execution.
 */
export class SingleCompanyStore {
  private cachedConfig: CompanyConfig | null = null;
  private cachedCatalog: CatalogCache | null = null;
  private activeSyncLockTime: number | null = null;

  /**
   * Initializes or loads the single company configuration.
   * If storage does not yet have config, seeds from environment variables.
   */
  async getCompany(): Promise<CompanyConfig> {
    if (this.cachedConfig) {
      return { ...this.cachedConfig };
    }

    const storage = getStorage();
    const stored = await storage.readConfig();
    if (stored) {
      this.cachedConfig = stored;
      return { ...this.cachedConfig };
    }

    // Seed initial configuration from environment variables
    const now = new Date();
    const initialConfig: CompanyConfig = {
      id: DEFAULT_COMPANY_ID,
      company_name: (process.env.COMPANY_NAME || 'Item Master Company').trim(),
      username: (process.env.ADMIN_USERNAME || 'admin').trim(),
      password_hash: DEFAULT_PASSWORD_HASH,
      status: 'ACTIVE',
      google_drive_folder_id: null,
      google_drive_file_id: null,
      google_drive_file_name: null,
      google_drive_md5: null,
      google_drive_modified_time: null,
      google_refresh_token: null,
      active_catalog_version: null,
      data_version: null,
      item_count: 0,
      last_sync_at: null,
      sync_status: 'IDLE',
      sync_error: null,
      created_at: now,
      updated_at: now,
    };

    await storage.writeConfig(initialConfig);
    this.cachedConfig = initialConfig;
    return { ...this.cachedConfig };
  }

  async findCompanyById(id: string): Promise<CompanyConfig | null> {
    const company = await this.getCompany();
    if (company.id === id || id === DEFAULT_COMPANY_ID) {
      return { ...company };
    }
    // In permanent one-company architecture, return the single company
    return { ...company };
  }

  async findCompanyByUsername(username: string): Promise<CompanyConfig | null> {
    const company = await this.getCompany();
    if (company.username.trim().toLowerCase() === username.trim().toLowerCase()) {
      return { ...company };
    }
    return null;
  }

  async updateCompanyProfile(id: string, data: UpdateProfileData): Promise<CompanyConfig | null> {
    const company = await this.getCompany();
    if (data.company_name !== undefined) {
      company.company_name = data.company_name.trim();
    }
    company.updated_at = new Date();

    await getStorage().writeConfig(company);
    this.cachedConfig = company;
    return { ...company };
  }

  async updateCompanyCredentials(id: string, updates: UpdateCredentialsData): Promise<CompanyConfig | null> {
    const company = await this.getCompany();
    if (updates.username !== undefined) {
      company.username = updates.username.trim();
    }
    if (updates.password_hash !== undefined) {
      company.password_hash = updates.password_hash;
    }
    company.updated_at = new Date();

    await getStorage().writeConfig(company);
    this.cachedConfig = company;
    return { ...company };
  }

  async updateCompanyStatus(id: string, status: CompanyStatus): Promise<CompanyConfig | null> {
    const company = await this.getCompany();
    company.status = status;
    company.updated_at = new Date();

    await getStorage().writeConfig(company);
    this.cachedConfig = company;
    return { ...company };
  }

  async updateCompanySyncState(id: string, updates: UpdateSyncStateData): Promise<CompanyConfig | null> {
    const company = await this.getCompany();
    if (updates.google_drive_folder_id !== undefined) company.google_drive_folder_id = updates.google_drive_folder_id;
    if (updates.google_drive_file_id !== undefined) company.google_drive_file_id = updates.google_drive_file_id;
    if (updates.google_drive_file_name !== undefined) company.google_drive_file_name = updates.google_drive_file_name;
    if (updates.google_drive_md5 !== undefined) company.google_drive_md5 = updates.google_drive_md5;
    if (updates.google_drive_modified_time !== undefined) company.google_drive_modified_time = updates.google_drive_modified_time;
    if (updates.google_refresh_token !== undefined) company.google_refresh_token = updates.google_refresh_token;
    if (updates.active_catalog_version !== undefined) company.active_catalog_version = updates.active_catalog_version;
    if (updates.sync_status !== undefined) company.sync_status = updates.sync_status;
    if (updates.sync_error !== undefined) company.sync_error = updates.sync_error;
    if (updates.last_sync_at !== undefined) company.last_sync_at = updates.last_sync_at;
    if (updates.data_version !== undefined) company.data_version = updates.data_version;
    if (updates.item_count !== undefined) company.item_count = updates.item_count;

    company.updated_at = new Date();
    await getStorage().writeConfig(company);
    this.cachedConfig = company;
    return { ...company };
  }

  async acquireSyncLock(company_id?: string): Promise<boolean> {
    const now = Date.now();
    if (this.activeSyncLockTime && now - this.activeSyncLockTime < 10 * 60 * 1000) {
      return false; // Already locked
    }

    const company = await this.getCompany();
    if (company.sync_status === 'IN_PROGRESS' && this.activeSyncLockTime && now - this.activeSyncLockTime < 10 * 60 * 1000) {
      return false;
    }

    this.activeSyncLockTime = now;
    company.sync_status = 'IN_PROGRESS';
    company.updated_at = new Date();
    await getStorage().writeConfig(company);
    this.cachedConfig = company;
    return true;
  }

  async releaseSyncLock(company_id?: string): Promise<void> {
    this.activeSyncLockTime = null;
  }

  /**
   * Two-Phase Versioned Catalog Publication:
   * 1. Writes new immutable versioned blob: catalog-v<data_version>.json.gz
   * 2. Verifies new blob is present and readable.
   * 3. Atomically updates active_catalog_version, data_version, item_count, and Drive MD5 in config.
   * 4. Cleans up previous versioned blob.
   * 5. Releases sync lock.
   */
  async publishCompanyItems(
    company_id: string,
    items: CatalogItem[],
    data_version: string,
    driveMetadata?: {
      google_drive_md5?: string | null;
      google_drive_modified_time?: Date | null;
    }
  ): Promise<{ count: number }> {
    const storage = getStorage();
    const company = await this.getCompany();
    const previousVersion = company.active_catalog_version;
    const now = new Date();

    const catalogData: CatalogCache = {
      data_version,
      google_drive_md5: driveMetadata?.google_drive_md5 || null,
      item_count: items.length,
      published_at: now.toISOString(),
      items,
    };

    try {
      // Step 1: Write versioned catalog blob
      await storage.writeCatalog(data_version, catalogData);

      // Step 2: Verify written blob
      const verified = await storage.readCatalog(data_version);
      if (!verified || verified.item_count !== items.length) {
        throw new Error('Verification of written catalog blob failed.');
      }

      // Step 3: Atomic pointer update in company configuration
      company.active_catalog_version = data_version;
      company.data_version = data_version;
      company.item_count = items.length;
      if (driveMetadata?.google_drive_md5 !== undefined) {
        company.google_drive_md5 = driveMetadata.google_drive_md5;
      }
      if (driveMetadata?.google_drive_modified_time !== undefined) {
        company.google_drive_modified_time = driveMetadata.google_drive_modified_time;
      }
      company.last_sync_at = now;
      company.sync_status = 'SUCCESS';
      company.sync_error = null;
      company.updated_at = now;

      await storage.writeConfig(company);
      this.cachedConfig = company;
      this.cachedCatalog = catalogData;

      // Step 4: Clean up old catalog version if different
      if (previousVersion && previousVersion !== data_version) {
        await storage.deleteCatalog(previousVersion);
      }

      this.activeSyncLockTime = null;
      return { count: items.length };
    } catch (err) {
      this.activeSyncLockTime = null;
      throw err;
    }
  }

  async recordSyncFailure(company_id: string, errorMessage: string): Promise<void> {
    const company = await this.getCompany();
    company.sync_status = 'FAILED';
    company.sync_error = errorMessage;
    company.updated_at = new Date();

    await getStorage().writeConfig(company);
    this.cachedConfig = company;
    this.activeSyncLockTime = null;
  }

  async getCompanyItems(
    company_id?: string,
    options?: { limit?: number; offset?: number }
  ): Promise<{ items: CatalogItem[]; total: number; data_version: string | null }> {
    const company = await this.getCompany();
    if (!company.active_catalog_version) {
      return { items: [], total: 0, data_version: null };
    }

    // Check warm memory cache
    if (this.cachedCatalog && this.cachedCatalog.data_version === company.active_catalog_version) {
      const allItems = this.cachedCatalog.items;
      return this.sliceItems(allItems, company.active_catalog_version, options);
    }

    // Load from storage adapter
    const catalog = await getStorage().readCatalog(company.active_catalog_version);
    if (!catalog) {
      return { items: [], total: 0, data_version: company.active_catalog_version };
    }

    this.cachedCatalog = catalog;
    return this.sliceItems(catalog.items, company.active_catalog_version, options);
  }

  private sliceItems(
    allItems: CatalogItem[],
    data_version: string,
    options?: { limit?: number; offset?: number }
  ): { items: CatalogItem[]; total: number; data_version: string } {
    const total = allItems.length;
    if (options?.limit !== undefined) {
      const offset = options.offset || 0;
      const items = allItems.slice(offset, offset + options.limit);
      return { items, total, data_version };
    }
    return { items: [...allItems], total, data_version };
  }

  async clearAll(): Promise<void> {
    this.cachedConfig = null;
    this.cachedCatalog = null;
    this.activeSyncLockTime = null;
    await getStorage().clearAll();
  }
}

// Global singleton instance for the process
const globalForDb = globalThis as unknown as { appDb?: SingleCompanyStore };
export const db = globalForDb.appDb || new SingleCompanyStore();
if (process.env.NODE_ENV !== 'production') globalForDb.appDb = db;
