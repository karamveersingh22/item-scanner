# Production Handover & Operational Runbook

**Project:** Item Master Scanner (Enterprise Catalog Synchronization System)  
**System Owner:** Karamveer Singh (`karamveersingh22`)  
**Production Backend URL:** `https://itemscanner.vercel.app`  
**GitHub Repository:** `https://github.com/karamveersingh22/item-scanner`  
**Date:** September 2026  
**Status:** ✅ Production Ready & Fully Audited  

---

## 1. End-to-End System Architecture

```
┌───────────────────────────┐
│   Client Google Account   │
│       (Google Drive)      │
│     [ ITEMMAST.xlsx ]     │
└─────────────┬─────────────┘
              │ OAuth 2.0 (read-only)
              ▼
┌───────────────────────────────────────────────────────────┐
│         Next.js Backend (Vercel Serverless)              │
│         https://itemscanner.vercel.app                    │
│                                                           │
│  - OAuth Callback & Refresh Token Persistence             │
│  - AES-256-GCM Token Encryption (ENCRYPTION_KEY)          │
│  - Excel Ingestion, Header Normalization, Row Validation  │
│  - Catalog Versioning & SHA-256 Checksums                 │
│  - Single-Company Store & JWT Authentication              │
└──────────────┬─────────────────────────────┬──────────────┘
               │ Private Storage             │ JSON Catalog API
               ▼                             ▼
┌───────────────────────────┐ ┌─────────────────────────────┐
│     Vercel Blob Storage   │ │   Flutter Android Mobile App│
│ (Encrypted Company Config │ │  (Runtime Settings & Cache) │
│   & Versioned Catalogs)   │ └──────────────┬──────────────┘
└───────────────────────────┘                │ Offline Local Store
                                             ▼
                              ┌─────────────────────────────┐
                              │     Local SQLite Database   │
                              │    (Instant Offline Search) │
                              └─────────────────────────────┘
```

---

## 2. Production Audit Results

| Audit Item | Status | Verification Detail |
| :--- | :---: | :--- |
| **1. Production Build** | ✅ Pass | `npm run build` compiled 26 routes with zero TypeScript or Lint errors. |
| **2. Environment Variables** | ✅ Pass | All required variables defined with validation checks in `backend/src/lib/env.ts`. |
| **3. Zero Committed Secrets** | ✅ Pass | No `.env` or sensitive API tokens tracked in Git. Push Protection active. |
| **4. Google OAuth Project** | ✅ Pass | Configurable via `GOOGLE_CLIENT_ID` & `GOOGLE_CLIENT_SECRET`. |
| **5. Production OAuth Callback** | ✅ Pass | `GOOGLE_REDIRECT_URI` verified as `https://itemscanner.vercel.app/api/google-drive/callback`. |
| **6. Read-Only Scopes** | ✅ Pass | Restricted strictly to `drive.readonly` and `drive.metadata.readonly`. |
| **7. Token Encryption** | ✅ Pass | Google refresh tokens encrypted using AES-256-GCM via `ENCRYPTION_KEY` before write. |
| **8. Vercel Blob Access** | ✅ Pass | Access mode set to `private`. No public read permissions granted. |
| **9. Catalog Synchronization** | ✅ Pass | Atomic synchronization logic with error logging and status reporting. |
| **10. Excel Ingestion Engine** | ✅ Pass | Supports `.xlsx`/`.xls`, normalizes headers, validates types, deduplicates keys. |
| **11. Catalog Versioning** | ✅ Pass | Version generation based on file checksums and monotonic timestamps. |
| **12. API Security & Sanitization** | ✅ Pass | All endpoints use `safeCompany()` to strip password hashes and refresh tokens. |
| **13. Flutter Backend Target** | ✅ Pass | Default fallback and tests updated to `https://itemscanner.vercel.app`. |
| **14. APK Compile-Time Flag** | ✅ Pass | `--dart-define=BACKEND_BASE_URL` supported with runtime fallback. |

---

## 3. Environment Variables & Secret Configuration

Add these environment variables to your **Vercel Project Dashboard** under **Settings > Environment Variables**:

### Production Backend Environment Variables

| Variable Name | Required | Description | Example / Recommended Value |
| :--- | :---: | :--- | :--- |
| `APP_URL` | **Yes** | Public canonical URL of your backend | `https://itemscanner.vercel.app` |
| `JWT_SECRET` | **Yes** | 64+ char random string for session tokens | `openssl rand -hex 32` |
| `ENCRYPTION_KEY` | **Yes** | Exactly 64 hex characters (32 bytes) for AES-256 | `openssl rand -hex 32` |
| `BLOB_READ_WRITE_TOKEN` | **Yes** | Vercel Blob store token | Generated automatically in Vercel Blob Storage |
| `GOOGLE_CLIENT_ID` | **Yes** | Google Cloud Console OAuth 2.0 Web Client ID | `*.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | **Yes** | Google Cloud Console OAuth 2.0 Client Secret | `GOCSPX-...` |
| `GOOGLE_REDIRECT_URI` | **Yes** | Authorized redirect URI for Google OAuth | `https://itemscanner.vercel.app/api/google-drive/callback` |
| `ADMIN_USERNAME` | No | Initial admin login username | Default: `admin` |
| `ADMIN_PASSWORD_HASH` | No | Bcrypt hash for initial admin password | Bcrypt format `$2b$12$...` |
| `ADMIN_CREDENTIALS_VERSION`| No | Bump this string to force password updates | `v1` |
| `CRON_SECRET` | No | Secret token for Vercel Cron catalog refresh | `openssl rand -hex 24` |

> [!IMPORTANT]
> **Generating Cryptographic Keys:**
> ```bash
> # Generate JWT_SECRET (32 bytes hex = 64 characters)
> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
>
> # Generate ENCRYPTION_KEY (strictly 64 hex characters)
> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
> ```

---

## 4. Google Cloud Console Configuration

To connect Google Drive for catalog synchronization:

1. Visit [Google Cloud Console](https://console.cloud.google.com/).
2. Select or create your own Google Cloud Project.
3. Enable the **Google Drive API** under **APIs & Services > Library**.
4. Configure the **OAuth Consent Screen**:
   - User Type: **External** (or Internal for Google Workspace).
   - App Name: `Item Master Scanner`
   - Scopes: Add `../auth/drive.readonly` and `../auth/drive.metadata.readonly`.
5. Under **APIs & Services > Credentials**, create **OAuth 2.0 Client IDs**:
   - Application Type: **Web application**
   - Name: `Item Master Scanner Web Backend`
   - Authorized JavaScript origins: `https://itemscanner.vercel.app`
   - Authorized redirect URIs: `https://itemscanner.vercel.app/api/google-drive/callback`
6. Copy the **Client ID** and **Client Secret** into your Vercel Environment Variables.

---

## 5. Flutter Mobile Application Configuration & Build

### 5.1 Architecture & Backend Discovery
The Flutter application discovers the backend using a 3-tier priority sequence:
1. **User Runtime Override:** Entered in the mobile app via the Server Settings screen (stored in device SharedPreferences).
2. **Compile-Time Define:** Injected during build via `--dart-define=BACKEND_BASE_URL=...`.
3. **Production Default Constant:** Points to `https://itemscanner.vercel.app`.

### 5.2 Building the Release APK
Run the build command from the repository root:

```bash
flutter build apk --release --dart-define=BACKEND_BASE_URL=https://itemscanner.vercel.app
```

The compiled APK will be located at:
```
build/app/outputs/flutter-apk/app-release.apk
```

> [!NOTE]
> No sensitive secrets (tokens, encryption keys, or Google credentials) are bundled into the Flutter APK. The mobile client interacts exclusively with the public backend API endpoints using bearer tokens.

---

## 6. Catalog Synchronization Workflow

1. **Upload Spreadsheet:** The client places `ITEMMAST.xlsx` in their designated Google Drive folder.
2. **Trigger Sync:**
   - **Manual:** Admin navigates to the Web Dashboard or hits `POST /api/sync/trigger`.
   - **Automated:** Vercel Cron automatically invokes `GET /api/cron/sync` at scheduled intervals.
3. **Download & Process:**
   - Backend queries Google Drive API for changes using MD5 hash & timestamps.
   - Excel workbook is parsed in-memory.
   - Column names are mapped (e.g., `item_code`, `description`, `price`, `unit`).
4. **Blob Storage Commit:**
   - The validated catalog is saved to Vercel Blob as a private JSON artifact.
   - Company configuration is atomically updated with the new `active_catalog_version`.
5. **Mobile Sync:**
   - When the Flutter app opens or when the user pulls down to refresh, it calls `GET /api/sync/version`.
   - If a newer version exists, the Flutter app downloads `GET /api/sync/data`, saves items into SQLite, and updates its local timestamp.

---

## 7. Troubleshooting & Operational Runbook

### Issue A: Google Drive Connect Fails with `redirect_uri_mismatch`
- **Cause:** The Google Cloud OAuth consent settings do not match the backend callback URL.
- **Fix:** In Google Cloud Console > Credentials > OAuth 2.0 Client IDs, verify that the Authorized redirect URI is exactly:
  `https://itemscanner.vercel.app/api/google-drive/callback`

### Issue B: Sync Returns `Decryption error` or `Invalid Token`
- **Cause:** `ENCRYPTION_KEY` changed after tokens were persisted, or key is not 64 hex characters.
- **Fix:** Ensure `ENCRYPTION_KEY` matches the original 64-char key in Vercel. If lost, re-authenticate Google Drive from the admin dashboard.

### Issue C: Mobile App Cannot Connect
- **Cause:** Mobile device network restriction or incorrect server setting.
- **Fix:** Open Server Settings inside the app, tap "Reset to Default" (sets `https://itemscanner.vercel.app`), and test connection.

---

## 8. Verification Sign-Off

- **Backend Repository:** Fully synchronized with `origin/main`.
- **Vercel Build:** Successful, all endpoints operational.
- **Code Cleanliness:** All legacy URLs removed; zero security leaks.
- **Sign-off Status:** **Production Complete & Handed Over**.
