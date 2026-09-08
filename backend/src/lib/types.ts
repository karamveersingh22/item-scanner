export type CompanyStatus = 'ACTIVE' | 'DISABLED';
export type SyncStatus = 'IDLE' | 'IN_PROGRESS' | 'SUCCESS' | 'FAILED';

export interface CatalogItem {
  i_code: string;
  item_name: string | null;
  describe: string | null;
  quantity: string | null;
  rate: string | null;
  disc_per: string | null;
  disc_b: string | null;
}

export interface CatalogCache {
  data_version: string;
  google_drive_md5: string | null;
  item_count: number;
  published_at: string;
  items: CatalogItem[];
}

export interface Company {
  id: string;
  company_name: string;
  username: string;
  password_hash: string;
  admin_credentials_version?: string | null;
  status: CompanyStatus;
  google_drive_folder_id: string | null;
  google_drive_file_id: string | null;
  google_drive_file_name: string | null;
  google_drive_md5: string | null;
  google_drive_modified_time: Date | null;
  google_refresh_token: string | null;
  active_catalog_version: string | null;
  data_version: string | null;
  item_count: number;
  last_sync_at: Date | null;
  sync_status: SyncStatus;
  sync_error: string | null;
  created_at: Date;
  updated_at: Date;
}

export type CompanyConfig = Company;

export type SafeCompany = Omit<Company, 'password_hash' | 'google_refresh_token' | 'admin_credentials_version'>;

export interface CompanyJWTPayload {
  company_id: string;
  username: string;
  company_name: string;
  status: CompanyStatus;
  [key: string]: unknown;
}

export function toSafeCompany(company: Company): SafeCompany {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password_hash, google_refresh_token, admin_credentials_version, ...safe } = company;
  return safe;
}
