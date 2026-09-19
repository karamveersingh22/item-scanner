# Item Scanner - Complete Project Documentation (Source of Truth)

## 📋 Project Overview

**Item Scanner** is an offline-first inventory lookup mobile application for retail/warehouse environments. It allows workers to scan item codes (barcode/OCR) and instantly see pricing, quantity, and descriptions - completely offline after initial sync.

### Key Identities
- **Flutter Package**: `item_scanner`
- **Android App ID**: `com.example.item_scanner` (change for client)
- **App Title**: `ITEM MASTER`
- **Production Backend**: `https://itemscanner.vercel.app` (Next.js on Vercel)
- **GitHub**: `https://github.com/karamveersingh22/item-scanner`

---

## 🏗️ Full Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           GOOGLE DRIVE (Source of Truth)                    │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  ITEMMAST.xlsx (columns: I_CODE, ITEM_NAME, DESCRIBE, QUANTITY,   │   │
│  │  RATE, DISC_PER, DISC_B) - uploaded daily by client               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │ OAuth 2.0 (drive.readonly)
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    VERCEL SERVERLESS BACKEND (Next.js 16)                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  /api/sync/trigger  ──► Downloads Excel from Drive                │   │
│  │                        ──► Validates (unique I_CODE, required cols)│   │
│  │                        ──► Publishes to Private Vercel Blob        │   │
│  │                        ──► catalog-v<version>.json.gz (gzip)       │   │
│  │                                                                     │   │
│  │  /api/sync/data     ──► Paginated API (1000 items/page)           │   │
│  │                        ──► Version-aware: ?version=xxx             │   │
│  │                        ──► Returns {up_to_date: true} if same      │   │
│  │                                                                     │   │
│  │  /api/google-drive  ──► OAuth connect, file list, select          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                          Private Vercel Blob (access: 'private')          │
│                          Company config + Versioned catalogs              │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │ HTTPS + Bearer JWT
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    FLUTTER MOBILE APP (Android/iOS)                         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  SYNC DATABASE button ──► POST /api/sync/trigger (Drive→Blob)      │   │
│  │                        ──► GET /api/sync/data?version=local        │   │
│  │                        ──► Downloads to items_staging (SQLite)     │   │
│  │                        ──► Atomic swap: items_staging → items      │   │
│  │                                                                     │   │
│  │  Offline Search ──► Local SQLite (idx_items_icode) ──► < 1ms      │   │
│  │  Camera OCR ──► ML Kit Text Recognition ──► Regex I.CODE ──► SQL  │   │
│  │  Pricing ──► RATE * (100 - DISC_B) / 100                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔄 Business Logic Flow

### Daily Operation (Client Workflow)
1. **Morning**: Client updates `ITEMMAST.xlsx` on local PC → Drags to Google Drive (replaces existing)
2. **Anytime**: Client opens App → Presses `SYNC DATABASE`
3. **Automatic**: App calls backend → Backend fetches latest `ITEMMAST.xlsx` from Drive → Validates → Publishes to Blob
4. **Instant**: App downloads catalog → Atomic SQLite swap → Worker sees new prices immediately
5. **No Website**: Client never opens `itemscanner.vercel.app` after initial setup

### Sync Logic Details
- **Auto-detect**: Backend finds `ITEMMAST.xlsx` by name (newest if multiple) - no file ID management needed
- **Change Detection**: MD5 checksum of Drive file vs stored `google_drive_md5`
- **If unchanged**: Returns `unchanged: true` in 1 second, no download
- **If changed**: Downloads → Validates → Atomically publishes
- **Atomic Swap**: `items_staging` → single transaction → `items` (previous catalog untouched on failure)
- **Offline-First**: Phone SQLite works 100% offline after first successful sync

### Versioning
| Version Type | Purpose | Calculation |
|--------------|---------|-------------|
| `google_drive_md5` | Detect Drive file changes | MD5 of raw `.xlsx` binary |
| `data_version` | Client sync check | MD5 of normalized rows: `item_count + (i_code|rate|qty|disc_per|disc_b;)*` |

---

## 📱 Flutter App Architecture

### Screens
| Screen | File | Purpose |
|--------|------|---------|
| `AuthGate` | `lib/main.dart:47` | Checks session, routes to Login or Home |
| `LoginScreen` | `lib/screens/login_screen.dart` | Username/password + Server Settings |
| `HomePage` | `lib/main.dart:112` | Search, Sync, Scan, Item Card, Account |
| `ICodeScannerScreen` | `lib/screens/icode_scanner_screen.dart` | Camera OCR with laser animation |

### Services
| Service | File | Purpose |
|---------|------|---------|
| `ApiService` | `lib/services/api_service.dart` | HTTP calls to backend (login, sync, trigger) |
| `AuthService` | `lib/services/auth_service.dart` | JWT in FlutterSecureStorage, offline fallback |
| `CloudSyncService` | `lib/services/cloud_sync_service.dart` | Orchestrates Drive→Blob→Phone sync |
| `DatabaseService` | `lib/services/database_service.dart` | SQLite: items, items_staging, pricing engine |
| `DatabaseService` | `lib/services/database_service.dart` | `findItem()`, `calculateDiscountedRate()` |

### Key Flutter Behaviors
- **Auto-login**: Saved credentials → background login on app start
- **Offline session**: If no internet, uses cached company profile
- **15-min auto-sync**: Background check while app foreground (non-blocking)
- **Force sync**: `SYNC DATABASE` button bypasses interval, triggers Drive→Blob
- **Search**: Instant at ≥3 digits, shows microseconds latency
- **OCR**: ML Kit Text Recognition, 350ms frame throttle, regex `I.CODE: 12345`

---

## 🔧 Backend Architecture (Next.js on Vercel)

### API Routes
| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/auth/login` | POST | Public | Returns JWT + sets httpOnly cookie |
| `/api/auth/me` | GET | Bearer | Current company profile |
| `/api/auth/logout` | POST | Bearer | Clears session |
| `/api/company/profile` | GET/PUT | Bearer | Company name |
| `/api/company/credentials` | PUT | Bearer | Change username/password |
| `/api/google-drive/auth-url` | GET | Bearer | OAuth URL with signed state |
| `/api/google-drive/callback` | GET | Public | OAuth callback, encrypts refresh token |
| `/api/google-drive/status` | GET | Bearer | Connection + selected file |
| `/api/google-drive/files` | GET | Bearer | List `.xlsx` files in Drive |
| `/api/google-drive/select` | POST | Bearer | Save file_id + name |
| `/api/google-drive/test` | GET | Bearer | Health check |
| `/api/sync/trigger` | POST | Bearer | **Drive → Blob (auto-detects ITEMMAST.xlsx)** |
| `/api/sync/status` | GET | Bearer | Sync state, item_count, versions |
| `/api/sync/data` | GET | Bearer | Paginated catalog download |

### Core Libraries
| Library | File | Purpose |
|---------|------|---------|
| `auth.ts` | `backend/src/lib/auth.ts` | Bcrypt + JWT (HS256, 7-day expiry) |
| `db.ts` | `backend/src/lib/db.ts` | SingleCompanyStore (Blob + memory cache) |
| `storage.ts` | `backend/src/lib/storage.ts` | VercelBlobStorage / LocalFileStorage adapter |
| `google-drive.ts` | `backend/src/lib/google-drive.ts` | OAuth, Drive API, **findTargetSpreadsheet()** |
| `excel-parser.ts` | `backend/src/lib/excel-parser.ts` | AdmZip streaming parser, validates cols |
| `encryption.ts` | `backend/src/lib/encryption.ts` | AES-256-GCM for refresh tokens |

### Storage Model (CompanyConfig in Blob)
```typescript
{
  id: 'company-primary',
  company_name: 'Item Master Company',
  username: 'admin',
  password_hash: '$2b$12$...',  // bcrypt
  admin_credentials_version: 'v3',  // bump to force credential reload
  status: 'ACTIVE',
  google_refresh_token: 'encrypted...',
  google_drive_file_id: 'xyz789',  // auto-updated on sync
  google_drive_file_name: 'ITEMMAST.xlsx',
  google_drive_md5: 'abc123...',
  active_catalog_version: 'data_version_hash',
  data_version: 'data_version_hash',
  item_count: 6615,
  sync_status: 'SUCCESS',
  last_sync_at: '2026-09-19T10:30:00Z'
}
```

---

## 🔐 Authentication & Security

### Admin Login (Website)
- **URL**: `https://itemscanner.vercel.app/admin/login`
- **Default**: `admin` / `admin123!` (fallback hash in `db.ts:30`)
- **Change via Vercel Env**:
  ```
  ADMIN_USERNAME=clientname
  ADMIN_PASSWORD=PlainTextPassword123  // auto-hashed by backend
  ADMIN_CREDENTIALS_VERSION=v2  // must bump to apply
  ```
- **Or via website**: `/admin/credentials` after login

### Mobile App Login
- Same credentials as admin website
- JWT stored in **FlutterSecureStorage** (Android Keystore / iOS Keychain)
- Offline fallback: Cached profile in SharedPreferences
- Token expiry: 7 days → auto-refresh on next app open

### Google Drive OAuth
- **Scopes**: `drive.readonly`, `drive.metadata.readonly`, `userinfo.email`
- **Flow**: Admin connects once in `/admin/drive` → saves encrypted refresh token
- **Token Encryption**: AES-256-GCM via `ENCRYPTION_KEY` (64 hex chars)
- **Production**: Publish OAuth app to avoid 7-day token expiry

---

## 📊 Excel File Requirements

### Required Columns (case-insensitive)
```
I_CODE | ITEM_NAME | DESCRIBE | QUANTITY | RATE | DISC_PER | DISC_B
```

### Rules
- **I_CODE**: Unique, preserved as string (leading zeros kept: `001234`)
- **Duplicate I_CODE**: Rejected with 400 error
- **Missing columns**: Rejected with 400 error
- **First sheet only**: `xl/worksheets/sheet1.xml` parsed
- **File name**: Must end with `.xlsx` (case-insensitive)

### Pricing Formula
```
Final Price = RATE * (100 - DISC_B) / 100
```
- Strips `₹`, `Rs.`, `,`, `%` from inputs
- Falls back to raw RATE if parse fails

---

## 🛠️ All Changes Made (Chronological)

### 1. Fixed Admin Login (Plain Password Support)
**Files**: `backend/src/lib/db.ts`, `backend/.env.example`
- Added `ADMIN_PASSWORD` env (plain text) → auto-hashed with bcrypt on startup
- Priority: `ADMIN_PASSWORD_HASH` > `ADMIN_PASSWORD` > fallback `admin123!`
- Must bump `ADMIN_CREDENTIALS_VERSION` to apply changes

### 2. One-Click Sync (App triggers Drive→Blob)
**Files**: `lib/services/api_service.dart`, `lib/services/cloud_sync_service.dart`
- Added `ApiService.triggerSync()` → `POST /api/sync/trigger`
- `CloudSyncService.synchronize(force:true)` calls trigger before download
- Manual `SYNC DATABASE` = full Drive→Blob→Phone in one click

### 3. Build Fixes
**Files**: `android/gradle.properties`, `android/app/build.gradle.kts`
- Increased Gradle memory: `1536m/384m` → `4096m/1024m`
- Disabled release lint: `lint { checkReleaseBuilds = false }`
- Fixed `Metaspace OutOfMemoryError` during lint

### 4. Auto-Detect Excel File (No Website After Day 1)
**Files**: `backend/src/lib/google-drive.ts`, `backend/src/app/api/sync/trigger/route.ts`
- Added `findTargetSpreadsheet()`: finds `ITEMMAST.xlsx` (exact name, newest)
- Trigger route: tries stored file_id → if 404, auto-detects → saves new file_id
- Accepts optional `fileId` param in `getDriveFileMetadata()` and `downloadDriveFile()`
- **Result**: Client uploads new file daily → presses App Sync → works automatically

---

## 🚀 Deployment & Build Commands

### Backend (Vercel)
```bash
cd backend
npm install
npm run build        # TypeScript + Next.js compile (26 routes)
npm test             # 82+ tests (stages 2,4,5,6, blob, credentials)
# Push to GitHub → Vercel auto-deploys
```

**Required Vercel Environment Variables**:
```
ADMIN_USERNAME=admin
ADMIN_PASSWORD=YourPassword123
ADMIN_CREDENTIALS_VERSION=v1
JWT_SECRET=64-char-random-string
ENCRYPTION_KEY=64-hex-chars (32 bytes)
APP_URL=https://itemscanner.vercel.app
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxx
GOOGLE_REDIRECT_URI=https://itemscanner.vercel.app/api/google-drive/callback
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_xxx (auto-injected when Blob linked)
NODE_ENV=production
```

### Flutter Mobile
```bash
flutter pub get
flutter analyze      # Must show: No issues found
flutter test         # 30 tests (auth, sync, atomic, benchmarks)
flutter build apk --release --dart-define=BACKEND_BASE_URL=https://itemscanner.vercel.app
# Output: build/app/outputs/flutter-apk/app-release.apk (~92MB)
```

### Android Requirements
- Java 21 (Microsoft OpenJDK recommended)
- Android SDK: compileSdk 37, targetSdk 36, minSdk 21
- Gradle 9.1.0, AGP 9.0.1, Kotlin 2.3.20

---

## 🧪 Testing Checklist

### Backend
- [ ] `npm run build` passes (0 errors)
- [ ] `npm test` all 82+ tests pass
- [ ] `/api/sync/trigger` returns `Successfully synchronized X items`
- [ ] `/api/sync/data?version=xxx` returns `up_to_date: true` on repeat
- [ ] Google Drive connect → file list → select → sync works
- [ ] Duplicate I_CODE rejected with 400

### Mobile (on real device)
- [ ] Login with admin credentials
- [ ] `SYNC DATABASE` shows item count matching Excel
- [ ] Search I_CODE → `ITEM FOUND` with correct price
- [ ] Turn off internet → search still works (offline)
- [ ] `READ I.CODE` camera opens, scans printed label
- [ ] Change Excel in Drive → App Sync → new data appears
- [ ] 2nd phone without sync shows old data → press Sync → new data

---

## ⚠️ Known Limitations / Future Considerations

| Item | Status | Notes |
|------|--------|-------|
| 1D Barcode decoding | Not implemented | Only OCR text recognition |
| Multi-column FTS5 search | Not implemented | Only I_CODE exact match |
| Background daemon (terminated app) | Intentional no | Sync only on app open/foreground |
| Multi-company | Removed | Single-company architecture |
| Public Google Sheets export | Removed | Uses Drive API + OAuth |
| Google verification | Unverified | Internal use - click Advanced |

---

## 📁 Project Structure (Key Files)

```
item_scanner/
├── android/                      # Android native config
├── backend/                      # Next.js serverless backend
│   ├── src/
│   │   ├── app/
│   │   │   ├── admin/            # Admin website pages
│   │   │   └── api/              # All API routes
│   │   └── lib/                  # Core libraries
│   ├── .env.example              # Env template
│   └── package.json
├── lib/                          # Flutter app source
│   ├── main.dart                 # Entry, AuthGate, HomePage
│   ├── models/                   # CompanyInfo, SyncItem, SyncState
│   ├── screens/                  # Login, Scanner
│   └── services/                 # Api, Auth, CloudSync, Database
├── test/                         # Flutter tests (30)
├── pubspec.yaml                  # Flutter deps
└── easy_doc.md                   # THIS FILE
```

---

## 💡 For Future Coding Agents

### Critical Invariants
1. **Never store plain passwords** - only bcrypt hashes
2. **Atomic catalog swap** - `items_staging` → single transaction → `items`
3. **Offline-first** - search never makes network calls
4. **Version separation** - `google_drive_md5` (Drive) ≠ `data_version` (catalog)
5. **One company** - no multi-tenant code paths
6. **Private Blob** - `access: 'private'`, never public URLs

### Common Pitfalls
- **Changing env vars without bumping `ADMIN_CREDENTIALS_VERSION`** - Blob cache ignores new values
- **Deleting Drive file without re-select** - old `file_id` fails, now auto-detected
- **Duplicate I_CODE in Excel** - entire sync rejected
- **Gradle OOM** - use `org.gradle.jvmargs=-Xmx4096m` in `gradle.properties`
- **Flutter SDK version mismatch** - `pubspec.yaml` requires Dart ^3.12.2 (Flutter 3.47+)

### Debugging Commands
```bash
# Check Vercel logs
vercel logs itemscanner.vercel.app --follow

# Test backend API locally
cd backend && npm run dev

# Test Drive connection
curl -H "Authorization: Bearer <token>" https://itemscanner.vercel.app/api/google-drive/status

# Force sync from terminal
curl -X POST -H "Authorization: Bearer <token>" https://itemscanner.vercel.app/api/sync/trigger
```

---

## 📝 Version History

| Date | Change | Files |
|------|--------|-------|
| 2026-09-19 | Auto-detect ITEMMAST.xlsx on sync | `google-drive.ts`, `trigger/route.ts` |
| 2026-09-19 | One-click sync (App triggers Drive→Blob) | `api_service.dart`, `cloud_sync_service.dart` |
| 2026-09-19 | Plain ADMIN_PASSWORD support | `db.ts`, `.env.example` |
| 2026-09-19 | Gradle memory + lint fixes | `gradle.properties`, `app/build.gradle.kts` |
| 2026-09-19 | Initial production handover | All docs, backend, Flutter |

---

**This document is the single source of truth. Update it when architecture or business logic changes.**