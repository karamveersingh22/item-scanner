# Changes Log — Item Scanner Price Sync Bug

## Problem Summary
Category B shows correct price only; all other categories show raw `RATE` (discount=0, tax=0). Root cause: `data_version` hash in backend `excel-parser.ts` omitted `DISC_A`–`DISC_N` and `TAX_PER`, so any change to those columns kept the hash identical, devices received `{ up_to_date: true }`, and never re-downloaded the new columns — they remained NULL in SQLite.

## What Was Done So Far

### 1. Parser hash fix (`backend/src/lib/excel-parser.ts:282-297`)
- Extended `data_version` MD5 hash to include all 15 discount/tax columns:
  `i_code | rate | quantity | disc_per | disc_a | disc_b | ... | disc_n | tax_per`
- This ensures any change to discount/tax fields produces a new version, forcing re-download on all devices.

### 2. Documentation updates (`APP_DOCUMENTATION.md`)
- Added versioning invariants table clarifying which fields go into `data_version` vs `google_drive_md5`.
- Added §B5 documenting the "only category B priced correctly" root cause.
- Updated section 7 with impact table.

### 3. Drive re-upload (quick fix attempt)
- User re-uploaded `ITEMMAST.xlsx` to Google Drive to change the file's MD5.
- **Result:** Still same incorrect prices after sync.

### 4. Fresh install + rebuild
- User uninstalled app, rebuilt APK, fresh install, pressed SYNC DATABASE.
- **Result:** Still same incorrect prices.

## Why The Fixes Didn't Resolve It

### Why Drive re-upload failed
The sync trigger `POST /api/sync/trigger` checks the stored `google_drive_md5` against the remote file's MD5. If they match, it returns `{ up_to_date: true, items: [] }` **without re-parsing**. The old catalog already sitting in Vercel Blob was therefore reused — it only contains the original 7 columns (`i_code`, `rate`, `quantity`, `disc_per`, `disc_b` plus a few others) and **lacks** `disc_a`–`disc_n` and `tax_per`.

The API response from `GET /api/sync/data?version=0` confirms this:
```json
{
  "items": [
    {
      "i_code": "00048",
      "rate": "3786.0",
      "disc_per": "0.0",
      "disc_b": "19.0"
      // <-- missing: disc_a, disc_c, disc_d, ..., tax_per
    }
  ]
}
```

### Why fresh install + rebuild failed
Even with a fresh database (all 21 columns created by `onCreate`), the sync downloaded the **same old catalog** from Blob (because Drive MD5 hadn't actually changed, or the trigger's short-circuit skipped re-parse). The items table therefore has:
- `DISC_B` = populated (from old columns)
- `DISC_A`, `DISC_C`–`DISC_N` = NULL
- `TAX_PER` = NULL

This exactly produces the observed symptoms:
- Category B: discounted rate WITHOUT tax = `2810 × (100−56)/100 = 1236.40`
- Other categories: raw RATE = `2810` (discount=0, tax=0)

## Current Status (After New Session Fixes)
- **Parser hash fix:** Applied ✅
- **`CatalogItem` type fix:** Applied ✅ (was missing 14 columns)
- **`/api/sync/data` response fix:** Applied ✅ (was only sending 7 fields)
- **Schema-aware sync trigger:** Applied ✅ (bypasses MD5 short-circuit on schema upgrade)
- **`PARSER_SCHEMA_VERSION`:** Added, set to `2` ✅
- **Vercel deployment:** Needs re-deploy ❌
- **Phone databases:** Will auto-fix after deploy + sync ❌

## Root Cause Analysis: Why Fixes #1–4 Didn't Resolve (3 Additional Bugs Found)

### Bug #1: `CatalogItem` type missing new columns (`types.ts`)
The `CatalogItem` TypeScript interface only defined 7 fields. When `publishCompanyItems()`
serialized items to Vercel Blob, the new columns (`disc_a`–`disc_n`, `tax_per`) were silently
dropped because they weren't in the interface.

**Fix:** Extended `CatalogItem` to include all 21 fields.

### Bug #2: `/api/sync/data` response mapper only sent 7 fields
The `GET /api/sync/data` endpoint had a hardcoded `items.map()` that only included 7 properties.
Even if the Blob catalog had all 21 columns, the API response stripped the new ones.

**Fix:** Extended the response mapper to include all 21 fields.

### Bug #3: Drive MD5 short-circuit had no schema-awareness
The sync trigger compared Drive MD5 → if unchanged, returned `{ unchanged: true }` without
re-parsing. After a parser schema change, the Drive file MD5 is the same but the old Blob
catalog is stale.

**Fix:** Added `PARSER_SCHEMA_VERSION` constant mixed into the `data_version` hash. The trigger
detects schema upgrades by checking if stored catalog items have `disc_a`. If missing, it
bypasses the MD5 short-circuit and forces re-parse.

## What Was Done (New Session — Fixes #5–8)

### 5. Extended `CatalogItem` type (`backend/src/lib/types.ts`)
### 6. Extended `/api/sync/data` response (`backend/src/app/api/sync/data/route.ts`)
### 7. Added `PARSER_SCHEMA_VERSION = 2` (`backend/src/lib/excel-parser.ts`)
### 8. Schema-aware sync trigger (`backend/src/app/api/sync/trigger/route.ts`)

## What Needs to Happen Next

### 1. Deploy to Vercel
```bash
cd backend && vercel --prod
```

### 2. Trigger Sync from Device
Press **SYNC DATABASE** → trigger detects schema upgrade → forces re-parse → publishes
fresh 21-column catalog → device downloads it.

### 3. Verify
Item `15951` → `1458.95` for category B, `1499.74` for category D.

**No Drive file rename/replace needed.** The `PARSER_SCHEMA_VERSION` mechanism handles it automatically.