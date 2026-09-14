# Item Scanner One-Company Serverless Backend

Serverless Next.js (App Router) backend deployed on Vercel providing single-company management, Google Drive OAuth integration, private Vercel Blob catalog storage, and synchronization endpoints for the Flutter Item Scanner mobile application.

**Production URL:** `https://itemscanner.vercel.app`

---

## 1. Project Structure

```
backend/
├── scripts/
│   ├── test-credential-version.ts  # Credential reset & normalization tests
│   ├── test-private-blob.ts        # Private Vercel Blob adapter tests
│   ├── test-stage2.ts              # Authentication & company tests
│   ├── test-stage4.ts              # Single-company store & storage tests
│   ├── test-stage5.ts              # Google OAuth & Drive integration tests
│   └── test-stage6.ts              # XLSX parsing, atomicity & benchmarks
├── src/
│   ├── app/
│   │   ├── admin/                  # Web administration panel
│   │   ├── api/
│   │   │   ├── auth/
│   │   │   │   ├── login/route.ts  # POST: Company authentication
│   │   │   │   ├── logout/route.ts # POST: Clear session cookie
│   │   │   │   └── me/route.ts     # GET: Current session info
│   │   │   ├── company/
│   │   │   │   ├── credentials/route.ts # PUT: Update username / password
│   │   │   │   └── profile/route.ts     # GET/PUT: Company profile
│   │   │   ├── google-drive/
│   │   │   │   ├── auth-url/route.ts    # GET: Google OAuth authorization URL
│   │   │   │   ├── callback/route.ts    # GET: OAuth callback handler
│   │   │   │   ├── disconnect/route.ts  # POST: Safely unlink Google Drive
│   │   │   │   ├── files/route.ts       # GET: List Drive spreadsheets
│   │   │   │   ├── select/route.ts      # POST: Select ITEMMAST.xlsx file
│   │   │   │   ├── status/route.ts      # GET: Connection status
│   │   │   │   └── test/route.ts        # GET: Verify Drive token validity
│   │   │   └── sync/
│   │   │       ├── data/route.ts        # GET: Paginated catalog delivery
│   │   │       ├── status/route.ts      # GET: Live sync status & metrics
│   │   │       └── trigger/route.ts     # POST: Trigger server-side sync
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx                     # Management dashboard
│   └── lib/
│       ├── auth.ts                 # Bcrypt password hashing & Jose JWT verification
│       ├── db.ts                   # SingleCompanyStore & credential bootstrap
│       ├── encryption.ts           # AES-256-GCM token encryption at rest
│       ├── excel-parser.ts         # Adm-Zip OpenXML streaming parser & validation
│       ├── google-drive.ts         # Google OAuth & Drive API client
│       ├── response.ts             # Standardized API response wrappers
│       ├── storage.ts              # StorageAdapter (VercelBlobStorage & LocalFileStorage)
│       └── types.ts                # TypeScript domain interfaces
├── .env.example                    # Environment variables template
├── package.json                    # Next.js 16, React 19, @vercel/blob 2.8
└── tsconfig.json
```

---

## 2. Storage Architecture

The backend operates without an external relational database (no PostgreSQL, no Prisma, no Neon). Persistent state is maintained via the `StorageAdapter` abstraction:

* **Production (`VercelBlobStorage`)**:  
  Uses `@vercel/blob` with `access: 'private'`.
  * `company-config.json`: Stores single-company configuration, encrypted Google refresh tokens, and catalog pointers.
  * `catalog-v<version>.json.gz`: Stores compressed, versioned catalog payloads.
  * Blobs are read server-side via authenticated SDK calls (`get()` with `token: BLOB_READ_WRITE_TOKEN`). Raw blob URLs are never exposed.
* **Development / Testing (`LocalFileStorage`)**:  
  Stores files locally inside the `.data/` directory.
* **Warm In-Memory Cache (`SingleCompanyStore`)**:  
  Caches configuration and active catalogs in memory to maximize performance during serverless execution.

---

## 3. Environment Variables

Template file: `.env.example` (names only):

| Variable | Description |
| :--- | :--- |
| `COMPANY_NAME` | Organization display name |
| `ADMIN_USERNAME` | Admin login username |
| `ADMIN_PASSWORD_HASH` | Salted bcrypt hash of admin password |
| `ADMIN_CREDENTIALS_VERSION` | Version tag to force credential reset on deploy |
| `JWT_SECRET` | Cryptographic secret for signing session tokens (min 32 chars) |
| `NODE_ENV` | `development` or `production` |
| `APP_URL` | Base deployment URL (`https://itemscanner.vercel.app`) |
| `GOOGLE_CLIENT_ID` | Google Cloud Console OAuth 2.0 Web Client ID |
| `GOOGLE_CLIENT_SECRET` | Google Cloud Console OAuth 2.0 Client Secret |
| `GOOGLE_REDIRECT_URI` | Callback URL (`.../api/google-drive/callback`) |
| `ENCRYPTION_KEY` | 32-byte (64 hex chars) key for AES-256-GCM token encryption |
| `BLOB_READ_WRITE_TOKEN` | Injected by Vercel when linking private Blob store |

---

## 4. API Endpoints

### Authentication
* `POST /api/auth/login`: Authenticate with username and password.
* `GET /api/auth/me`: Retrieve current company profile.
* `POST /api/auth/logout`: Clear session cookies.

### Company Management
* `GET /api/company/profile`: Get company display name.
* `PUT /api/company/profile`: Update company display name.
* `PUT /api/company/credentials`: Update admin username and password.

### Google Drive Integration
* `GET /api/google-drive/auth-url`: Generate OAuth authorization URL with signed state.
* `GET /api/google-drive/callback`: Handle OAuth redirect and encrypt refresh token.
* `GET /api/google-drive/status`: Connection health and active spreadsheet filename.
* `GET /api/google-drive/files`: List available `.xlsx` files from connected Drive.
* `POST /api/google-drive/select`: Select `ITEMMAST.xlsx` file.
* `POST /api/google-drive/disconnect`: Unlink Drive without touching Drive files.
* `GET /api/google-drive/test`: Test authorization validity.

### Catalog Data Synchronization
* `POST /api/sync/trigger`: Trigger server-side XLSX download, validation, and publication.
* `GET /api/sync/status`: Live sync status and metadata.
* `GET /api/sync/data`: Paginated catalog delivery (`?limit=1000&offset=0&version=xxx`).

---

## 5. Testing

```bash
# Run all backend test suites
npm test

# Run specific test suites
npm run test:stage2        # Authentication & company tests
npm run test:stage4        # Single-company store & storage tests
npm run test:stage5        # Google OAuth & Drive API tests
npm run test:stage6        # Excel parsing & benchmarks
npm run test:blob          # Private Vercel Blob tests
npm run test:credentials   # Credential versioning tests
```
