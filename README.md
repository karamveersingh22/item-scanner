# Item Master Scanner — Multi-Company Cloud & Offline Architecture

High-performance, offline-first barcode & camera OCR inventory scanner application with a multi-company Next.js serverless backend and Google Drive spreadsheet synchronization.

---

## Architecture Overview

```text
[ Company Management Web Panel ]
             │
             ▼
[ Next.js Serverless Backend (App Router) ] ─── OAuth 2.0 (AES-256-GCM) ───► [ Google Drive (itemmast.xlsx) ]
             │
             │ GET /api/sync/data?version=xxx (JWT Session Protected)
             ▼
[ Flutter Mobile Application (Android / iOS) ]
   ├── Staging Table (items_staging)
   ├── Atomic Publication (Single SQLite Transaction)
   └── Active Catalog (items) ◄── ML Kit Camera OCR & Barcode (< 2ms offline search)
```

### Key Highlights
* **Zero Network Item Lookup**: Barcode scanning, camera OCR recognition, and `DatabaseService.findItem()` run **100% offline against local SQLite B-Trees** (< 2ms lookup speed).
* **Non-Blocking Background Sync**: Scanning and searching are never blocked or paused during synchronization.
* **True SQLite Atomicity**: The incoming catalog is downloaded in pages into an `items_staging` table. The active `items` catalog is swapped only upon 100% successful validation within a single transaction.
* **Strict Versioning Separation**:
  * `google_drive_md5`: MD5 checksum of the raw Google Drive `.xlsx` file.
  * `data_version`: Deterministic **MD5 hash** of the normalized catalog rows consumed by Flutter:
    `MD5(item_count + (i_code|rate|quantity|disc_per|disc_b;)*)`.
* **Automatic Sync Scope**: **Automatic synchronization while the application is running** (15-minute foreground periodic timer). Does not execute when the app is terminated/suspended (no WorkManager / background fetch / native background services). On app restart, startup synchronization executes asynchronously. Manual `[SYNC DATABASE]` bypasses the interval check.
* **Bounded Exponential Backoff**: Automatic retry for transient connection/5xx failures (2s, 5s, 15s, stop). Immediate abort on 401, 403, and validation errors.

---

## Production Environment Variables

Configure these in `backend/.env.production` (see `backend/.env.example`):

| Variable | Description | Example |
| :--- | :--- | :--- |
| `DATABASE_URL` | Serverless PostgreSQL connection URI | `postgresql://user:pass@ep-neon.tech/item_scanner?sslmode=require` |
| `JWT_SECRET` | Cryptographic secret for signing session tokens (min 32 chars) | `openssl rand -hex 32` |
| `NODE_ENV` | Environment mode (`development` / `production`) | `production` |
| `APP_URL` | Public production URL of Next.js deployment | `https://items.yourcompany.com` |
| `GOOGLE_CLIENT_ID` | Google Cloud Console OAuth 2.0 Client ID | `xxx.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | Google Cloud Console OAuth 2.0 Client Secret | `GOCSPX-xxx` |
| `GOOGLE_REDIRECT_URI` | Authorized OAuth 2.0 redirect callback URL | `https://items.yourcompany.com/api/google-drive/callback` |
| `ENCRYPTION_KEY` | 32-byte hex key for AES-256-GCM token encryption at rest | `openssl rand -hex 32` |

---

## Verification & Testing

### Flutter Test Suite
```bash
# Run all 29 Flutter tests (Auth, Sync, Atomic Staging, Rate Limiting, 10k/50k/100k benchmarks)
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

## Deployment Status
* **Locally Verified**: Yes (29/29 Flutter tests, 82/82 Backend tests, 0 analyzer issues, production build successful).
* **Deployment-Ready**: Yes (Docker/Vercel/Neon compatible serverless configuration, no hardcoded secrets).
* **Real Google Drive End-to-End Test**: **Real Google Drive end-to-end testing has NOT been performed yet.** (Mock and integration suite verified only).
* **Actually Deployed**: **Not deployed** (Pending user approval).

