# Item Master Scanner — One-Company Cloud & Offline Architecture

High-performance, offline-first barcode & camera OCR inventory scanner application with a single-company Next.js serverless backend on Vercel and Google Drive spreadsheet synchronization.

---

## Architecture Overview

```text
[ Single-Company Management Web Panel ]
                 │
                 ▼
[ Next.js Serverless Backend (Vercel) ] ─── OAuth 2.0 (AES-256-GCM) ───► [ Google Drive (ITEMMAST.xlsx) ]
                 │
                 │ Private Vercel Blob (access: 'private')
                 ▼
[ Paginated API (GET /api/sync/data) ]
                 │
                 ▼
[ Flutter Mobile Application (Android / iOS) ]
       ├── Staging Table (items_staging)
       ├── Atomic Publication (Single SQLite Transaction)
       └── Active Catalog (items) ◄── ML Kit Camera OCR & Barcode (microsecond local search)
```

### Key Highlights
* **Production Backend URL**: `https://item-scanner-beryl.vercel.app` (Vercel Serverless, zero PostgreSQL/Neon/Prisma).
* **Private Vercel Blob Storage**: Configuration and versioned compressed catalogs stored securely with `access: 'private'`.
* **Zero Network Item Lookup**: Barcode scanning, camera OCR recognition, and `DatabaseService.findItem()` run **100% offline against local SQLite B-Trees** (microsecond lookup speed).
* **Non-Blocking Background Sync**: Scanning and searching are never blocked or paused during synchronization.
* **True SQLite Atomicity**: The incoming catalog is downloaded in pages into an `items_staging` table. The active `items` catalog is swapped only upon 100% successful validation within a single SQLite transaction.
* **Strict Versioning Separation**:
  * `google_drive_md5`: MD5 checksum of the raw Google Drive `.xlsx` file. Used by Next.js to detect remote modifications.
  * `data_version`: Deterministic **MD5 hash** of the normalized catalog rows consumed by Flutter:
    `MD5(item_count + (i_code|rate|quantity|disc_per|disc_b;)*)`.
* **Automatic Sync Scope**: Automatic synchronization while the application is running (15-minute foreground periodic timer and app startup check). Does not execute when the app is terminated/suspended. Manual `[SYNC DATABASE]` bypasses the interval check.
* **Bounded Exponential Backoff**: Automatic retry for transient connection/5xx failures (2s, 5s, 15s). Immediate abort on 401, 403, duplicate `I_CODE`, and validation errors.

---

## Production Environment Variables

Configure these in the Vercel Dashboard or `backend/.env.production` (see `backend/.env.example`):

| Variable | Description |
| :--- | :--- |
| `COMPANY_NAME` | Organization display name |
| `ADMIN_USERNAME` | Admin login username |
| `ADMIN_PASSWORD_HASH` | Salted bcrypt hash of admin password |
| `ADMIN_CREDENTIALS_VERSION` | Version tag to force credential reset on deploy |
| `JWT_SECRET` | Cryptographic secret for signing session tokens (min 32 chars) |
| `NODE_ENV` | Environment mode (`development` / `production`) |
| `APP_URL` | Public production URL of Next.js deployment (`https://item-scanner-beryl.vercel.app`) |
| `GOOGLE_CLIENT_ID` | Google Cloud Console OAuth 2.0 Web Client ID |
| `GOOGLE_CLIENT_SECRET` | Google Cloud Console OAuth 2.0 Client Secret |
| `GOOGLE_REDIRECT_URI` | Authorized OAuth 2.0 redirect callback URL |
| `ENCRYPTION_KEY` | 32-byte (64 hex characters) key for AES-256-GCM token encryption at rest |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob read/write token for private storage |

---

## Verification & Testing

### Flutter Test Suite
```bash
# Run all 30 Flutter tests (Auth, Sync, Atomic Staging, Rate Limiting, 10k/50k/100k benchmarks)
flutter test

# Static analysis
flutter analyze
```

### Backend Test Suite
```bash
cd backend
npm test
npm run build
```

---

## Android Build Configuration
* `compileSdk = 37` (required by `flutter_secure_storage`)
* `targetSdk = 36`
* `minSdk = 21`
* Android Gradle Plugin = `9.0.1`
* Gradle = `9.1.0`
* Java = `21`
* Release APK: `build/app/outputs/flutter-apk/app-release.apk` (successfully built)

---

## Documentation
For complete technical specifications, see [APP_DOCUMENTATION.md](file:///d:/raman%20software/item_scanner/APP_DOCUMENTATION.md).
