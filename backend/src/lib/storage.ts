import fs from 'fs/promises';
import path from 'path';
import zlib from 'zlib';
import { put, del, head, getDownloadUrl } from '@vercel/blob';
import { CompanyConfig, CatalogCache } from './types';

export interface StorageAdapter {
  readConfig(): Promise<CompanyConfig | null>;
  writeConfig(config: CompanyConfig): Promise<void>;
  readCatalog(version: string): Promise<CatalogCache | null>;
  writeCatalog(version: string, data: CatalogCache): Promise<void>;
  deleteCatalog(version: string): Promise<void>;
  clearAll(): Promise<void>;
}

function reviveDates(config: any): CompanyConfig {
  return {
    ...config,
    google_drive_modified_time: config.google_drive_modified_time
      ? new Date(config.google_drive_modified_time)
      : null,
    last_sync_at: config.last_sync_at ? new Date(config.last_sync_at) : null,
    created_at: config.created_at ? new Date(config.created_at) : new Date(),
    updated_at: config.updated_at ? new Date(config.updated_at) : new Date(),
  };
}

/**
 * Local File Storage Adapter
 * Used for local development and deterministic automated test execution.
 * Stores config in .data/company-config.json and compressed catalogs in .data/catalog-v<version>.json.gz.
 */
export class LocalFileStorage implements StorageAdapter {
  private baseDir: string;

  constructor(customDir?: string) {
    this.baseDir = customDir || process.env.DATA_DIR || path.join(process.cwd(), '.data');
  }

  private async ensureDir(): Promise<void> {
    try {
      await fs.mkdir(this.baseDir, { recursive: true });
    } catch {
      // Directory already exists
    }
  }

  private get configPath(): string {
    return path.join(this.baseDir, 'company-config.json');
  }

  private getCatalogPath(version: string): string {
    return path.join(this.baseDir, `catalog-v${version}.json.gz`);
  }

  async readConfig(): Promise<CompanyConfig | null> {
    try {
      const data = await fs.readFile(this.configPath, 'utf8');
      const parsed = JSON.parse(data);
      return reviveDates(parsed);
    } catch (err: any) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async writeConfig(config: CompanyConfig): Promise<void> {
    await this.ensureDir();
    const json = JSON.stringify(config, null, 2);
    // Write atomically via temporary file
    const tmpPath = `${this.configPath}.tmp.${Date.now()}`;
    await fs.writeFile(tmpPath, json, 'utf8');
    await fs.rename(tmpPath, this.configPath);
  }

  async readCatalog(version: string): Promise<CatalogCache | null> {
    const gzPath = this.getCatalogPath(version);
    try {
      const gzBuffer = await fs.readFile(gzPath);
      const decompressed = zlib.gunzipSync(gzBuffer);
      return JSON.parse(decompressed.toString('utf8'));
    } catch (err: any) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async writeCatalog(version: string, data: CatalogCache): Promise<void> {
    await this.ensureDir();
    const json = JSON.stringify(data);
    const compressed = zlib.gzipSync(Buffer.from(json, 'utf8'));
    const finalPath = this.getCatalogPath(version);
    const tmpPath = `${finalPath}.tmp.${Date.now()}`;
    await fs.writeFile(tmpPath, compressed);
    await fs.rename(tmpPath, finalPath);
  }

  async deleteCatalog(version: string): Promise<void> {
    try {
      await fs.unlink(this.getCatalogPath(version));
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  async clearAll(): Promise<void> {
    try {
      const files = await fs.readdir(this.baseDir);
      for (const file of files) {
        await fs.unlink(path.join(this.baseDir, file));
      }
    } catch {
      // Directory may not exist yet
    }
  }
}

/**
 * Vercel Blob Storage Adapter (Production Serverless)
 * All blobs are stored with access: 'private' so they cannot be accessed directly via public URLs.
 * Blobs are downloaded server-side using authenticated tokens.
 */
export class VercelBlobStorage implements StorageAdapter {
  private configBlobName = 'company-config.json';

  private getCatalogBlobName(version: string): string {
    return `catalog-v${version}.json.gz`;
  }

  async readConfig(): Promise<CompanyConfig | null> {
    try {
      const token = process.env.BLOB_READ_WRITE_TOKEN;
      if (!token) return null;

      // Check if blob exists
      const blobDetails = await head(this.configBlobName, { token });
      if (!blobDetails) return null;

      // Access private blob using download URL
      const downloadUrl = getDownloadUrl(blobDetails.url);
      const res = await fetch(downloadUrl, {
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error(`Failed to fetch config blob: HTTP ${res.status}`);
      }

      const json = await res.json();
      return reviveDates(json);
    } catch (err: any) {
      if (err.name === 'BlobNotFoundError' || err.status === 404) return null;
      console.warn('VercelBlobStorage readConfig warning:', err.message);
      return null;
    }
  }

  async writeConfig(config: CompanyConfig): Promise<void> {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    const json = JSON.stringify(config, null, 2);
    await put(this.configBlobName, json, {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'application/json',
      token,
    });
  }

  async readCatalog(version: string): Promise<CatalogCache | null> {
    try {
      const token = process.env.BLOB_READ_WRITE_TOKEN;
      if (!token) return null;

      const blobName = this.getCatalogBlobName(version);
      const blobDetails = await head(blobName, { token });
      if (!blobDetails) return null;

      const downloadUrl = getDownloadUrl(blobDetails.url);
      const res = await fetch(downloadUrl, {
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error(`Failed to fetch catalog blob: HTTP ${res.status}`);
      }

      const arrayBuffer = await res.arrayBuffer();
      const decompressed = zlib.gunzipSync(Buffer.from(arrayBuffer));
      return JSON.parse(decompressed.toString('utf8'));
    } catch (err: any) {
      if (err.name === 'BlobNotFoundError' || err.status === 404) return null;
      console.warn(`VercelBlobStorage readCatalog(v${version}) warning:`, err.message);
      return null;
    }
  }

  async writeCatalog(version: string, data: CatalogCache): Promise<void> {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    const json = JSON.stringify(data);
    const compressed = zlib.gzipSync(Buffer.from(json, 'utf8'));
    const blobName = this.getCatalogBlobName(version);

    await put(blobName, compressed, {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'application/gzip',
      token,
    });
  }

  async deleteCatalog(version: string): Promise<void> {
    try {
      const token = process.env.BLOB_READ_WRITE_TOKEN;
      const blobName = this.getCatalogBlobName(version);
      const blobDetails = await head(blobName, { token });
      if (blobDetails) {
        await del(blobDetails.url, { token });
      }
    } catch {
      // Best-effort cleanup
    }
  }

  async clearAll(): Promise<void> {
    // For test resets if connected to test blob store
    try {
      const token = process.env.BLOB_READ_WRITE_TOKEN;
      await del(this.configBlobName, { token });
    } catch {
      // Ignore
    }
  }
}

// Select active storage adapter based on environment
function createStorageAdapter(): StorageAdapter {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    return new VercelBlobStorage();
  }
  return new LocalFileStorage();
}

let activeStorage: StorageAdapter = createStorageAdapter();

export function getStorage(): StorageAdapter {
  return activeStorage;
}

export function setStorageAdapter(adapter: StorageAdapter): void {
  activeStorage = adapter;
}
